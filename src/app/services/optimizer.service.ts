import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { MechanismService } from './mechanism.service';
import { TargetTrajectoryService } from './target-trajectory.service';
import { RealJoint, RevJoint } from '../model/joint';
import { RealLink } from '../model/link';
import { Mechanism } from '../model/mechanism/mechanism';
import { NewGridComponent } from '../component/new-grid/new-grid.component';
import { GpuEvaluator } from './gpu-evaluator';

export interface OptimizationProgress {
  generation: number;
  bestError: number;
  bestParams: number[];
  mode: 'GPU' | 'CPU';
}

@Injectable({ providedIn: 'root' })
export class OptimizerService {
  private running = false;
  private shouldStop = false;
  private gpuEvaluator: GpuEvaluator | null = null;

  isRunning$ = new BehaviorSubject<boolean>(false);
  progress$ = new BehaviorSubject<OptimizationProgress | null>(null);
  mode$ = new BehaviorSubject<'GPU' | 'CPU' | null>(null);

  constructor(
    private mechanismService: MechanismService,
    private trajectoryService: TargetTrajectoryService
  ) {}

  async startOptimization(targetJointId: string, options?: {
    populationSize?: number;
    maxGenerations?: number;
    searchRadius?: number;
  }): Promise<void> {
    if (this.running) return;

    const joints = this.mechanismService.joints;
    const links = this.mechanismService.links;

    const trajectory = this.trajectoryService.getTrajectory(targetJointId);
    if (!trajectory || trajectory.points.length < 2) {
      NewGridComponent.sendNotification('请先为目标关节绘制轨迹');
      return;
    }

    const targetPoints = trajectory.points.map(p => ({ x: p.x, y: p.y }));
    const searchRadius = options?.searchRadius ?? 5;

    // Optimize ALL joints except the input anchor (the fixed reference point)
    const allRealJoints = joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const inputJoint = allRealJoints.find(j => j.input && j.ground);

    // Optimizable = all joints except the input ground (anchor)
    const optimizableJoints = allRealJoints.filter(j => j !== inputJoint);
    const targetJointIndex = allRealJoints.findIndex(j => j.id === targetJointId);

    if (optimizableJoints.length < 1) {
      NewGridComponent.sendNotification('没有可优化的关节');
      return;
    }

    const linkTopology: { id: string; jointIds: string[] }[] = [];
    links.forEach(l => {
      if (l instanceof RealLink) {
        linkTopology.push({ id: l.id, jointIds: l.joints.map(j => j.id) });
      }
    });

    const allJointIds = allRealJoints.map(j => j.id);
    const optimizableIds = optimizableJoints.map(j => j.id);
    const inputAngVel = this.mechanismService.mechanisms[0]?.inputAngularVelocities?.[0] ?? 1;

    // Fixed joint positions (only input anchor is fixed)
    const fixedPositions: { [id: string]: { x: number; y: number } } = {};
    if (inputJoint) {
      fixedPositions[inputJoint.id] = { x: inputJoint.x, y: inputJoint.y };
    }

    // Try GPU path for simple four-bar
    const groundJoints = allRealJoints.filter(j => j.ground);
    const freeJoints = allRealJoints.filter(j => !j.ground);
    let useGpu = false;

    if (groundJoints.length === 2 && freeJoints.length === 2) {
      const otherGround = groundJoints.find(j => j !== inputJoint);
      const chain = this.traceFourBarChain(inputJoint!, otherGround!, freeJoints);
      if (chain) {
        try {
          if ((navigator as any).gpu) {
            const targetJointIdx = targetJointId === chain.free1.id ? 1 : 2;
            // GPU params: [xB, yB, xC, yC, xD, yD] — 6D
            this.gpuEvaluator = await GpuEvaluator.create({
              groundA: { x: inputJoint!.x, y: inputJoint!.y },
              groundD: { x: otherGround!.x, y: otherGround!.y },
              targetJointIdx,
              targetTrajectory: targetPoints,
              maxPopulation: 200,
            });
            if (this.gpuEvaluator) useGpu = true;
          }
        } catch (err: any) {
          console.error('[LinkMotion] GPU init failed:', err);
          this.gpuEvaluator = null;
        }
      }
    }

    const mode: 'GPU' | 'CPU' = useGpu ? 'GPU' : 'CPU';
    this.mode$.next(mode);

    // Dimension = 2 per optimizable joint
    const dimension = optimizableJoints.length * 2;
    const popSize = useGpu ? 200 : Math.max(50, dimension * 10);
    const maxGen = options?.maxGenerations ?? 999999;

    const bounds: { min: number; max: number }[] = [];
    optimizableJoints.forEach(j => {
      bounds.push({ min: j.x - searchRadius, max: j.x + searchRadius });
      bounds.push({ min: j.y - searchRadius, max: j.y + searchRadius });
    });

    NewGridComponent.sendNotification(
      `开始优化 [${mode}] 维度=${dimension} 种群=${popSize} 搜索范围=±${searchRadius}`
    );

    if (useGpu && this.gpuEvaluator && optimizableJoints.length === 3) {
      // GPU path: four-bar, 3 optimizable joints (B, C, D) = 6D
      await this.runGpuOptimization(optimizableJoints, bounds, popSize, maxGen, mode);
    } else {
      // CPU path: general case, any topology
      this.runCpuOptimization(
        targetJointId, targetJointIndex, allJointIds, optimizableIds,
        fixedPositions, linkTopology, joints, targetPoints,
        bounds, dimension, popSize, maxGen, inputAngVel, mode
      );
    }
  }

  // ===== GPU Path (four-bar only) =====

  private async runGpuOptimization(
    optimizableJoints: RealJoint[],
    bounds: { min: number; max: number }[],
    popSize: number, maxGen: number, mode: 'GPU' | 'CPU'
  ): Promise<void> {
    // GPU evaluates [xB, yB, xC, yC] — the first 4 params (ground D not on GPU yet)
    const dimension = 4; // GPU shader only supports 4D for now
    const gpuBounds = bounds.slice(0, 4);
    const F = 0.8, CR = 0.9;

    const population: number[][] = [];
    for (let i = 0; i < popSize; i++) {
      const ind: number[] = [];
      for (let d = 0; d < dimension; d++) {
        ind.push(gpuBounds[d].min + Math.random() * (gpuBounds[d].max - gpuBounds[d].min));
      }
      population.push(ind);
    }

    this.running = true;
    this.shouldStop = false;
    this.isRunning$.next(true);
    this.progress$.next(null);

    let fitness = await this.gpuEvaluator!.evaluatePopulation(population);
    let bestIdx = 0;
    for (let i = 1; i < popSize; i++) {
      if (fitness[i] < fitness[bestIdx]) bestIdx = i;
    }

    let gen = 0;
    for (gen = 1; gen <= maxGen; gen++) {
      if (this.shouldStop) break;

      const trials: number[][] = [];
      for (let i = 0; i < popSize; i++) {
        let r1: number, r2: number, r3: number;
        do { r1 = Math.floor(Math.random() * popSize); } while (r1 === i);
        do { r2 = Math.floor(Math.random() * popSize); } while (r2 === i || r2 === r1);
        do { r3 = Math.floor(Math.random() * popSize); } while (r3 === i || r3 === r1 || r3 === r2);

        const jrand = Math.floor(Math.random() * dimension);
        const trial: number[] = [];
        for (let d = 0; d < dimension; d++) {
          if (Math.random() < CR || d === jrand) {
            let v = population[r1][d] + F * (population[r2][d] - population[r3][d]);
            v = Math.max(gpuBounds[d].min, Math.min(gpuBounds[d].max, v));
            trial.push(v);
          } else {
            trial.push(population[i][d]);
          }
        }
        trials.push(trial);
      }

      const trialFitness = await this.gpuEvaluator!.evaluatePopulation(trials);
      for (let i = 0; i < popSize; i++) {
        if (trialFitness[i] <= fitness[i]) {
          population[i] = trials[i];
          fitness[i] = trialFitness[i];
          if (trialFitness[i] < fitness[bestIdx]) bestIdx = i;
        }
      }

      if (gen % 5 === 0 || gen === 1) {
        this.progress$.next({ generation: gen, bestError: fitness[bestIdx], bestParams: [...population[bestIdx]], mode });
      }
      // No auto-stop — user manually stops
    }

    this.gpuEvaluator?.destroy();
    this.gpuEvaluator = null;
    this.finishOptimization(gen, fitness[bestIdx], population[bestIdx], mode);
  }

  // ===== CPU Path (any topology) =====

  private runCpuOptimization(
    targetJointId: string, targetJointIndex: number,
    allJointIds: string[], optimizableIds: string[],
    fixedPositions: { [id: string]: { x: number; y: number } },
    linkTopology: { id: string; jointIds: string[] }[],
    joints: any[], targetPoints: { x: number; y: number }[],
    bounds: { min: number; max: number }[], dimension: number,
    popSize: number, maxGen: number, inputAngVel: number,
    mode: 'GPU' | 'CPU'
  ): void {
    const PENALTY = 1e6;

    const evaluate = (params: number[]): number => {
      try {
        // Build joint positions: fixed + optimizable
        const jointPositions: { [id: string]: { x: number; y: number } } = { ...fixedPositions };
        optimizableIds.forEach((id, i) => {
          jointPositions[id] = { x: params[i * 2], y: params[i * 2 + 1] };
        });

        // Reconstruct joints
        const newJoints: RealJoint[] = [];
        const jointMap: { [id: string]: RealJoint } = {};
        allJointIds.forEach(id => {
          const pos = jointPositions[id];
          const orig = joints.find((j: any) => j.id === id) as RealJoint;
          const j = new RevJoint(id, pos.x, pos.y, orig.input, orig.ground);
          newJoints.push(j);
          jointMap[id] = j;
        });

        // Restore connectivity
        allJointIds.forEach(id => {
          const orig = joints.find((j: any) => j.id === id) as RealJoint;
          jointMap[id].connectedJoints = orig.connectedJoints
            .filter((cj: any) => cj instanceof RealJoint)
            .map((cj: any) => jointMap[cj.id]).filter(Boolean);
        });

        // Reconstruct links
        const newLinks: RealLink[] = [];
        linkTopology.forEach(lt => {
          const lj = lt.jointIds.map(jid => jointMap[jid]).filter(Boolean);
          if (lj.length >= 2) {
            const link = new RealLink(lt.id, lj);
            newLinks.push(link);
            lj.forEach(j => { if (!j.links.includes(link)) j.links.push(link); });
          }
        });

        // Solve mechanism
        const mech = new Mechanism(newJoints, newLinks, [], [], false, 'cm',
          Math.abs(inputAngVel) > 0 ? inputAngVel : 1);

        if (!mech.isMechanismValid() || mech.joints.length < 10) return PENALTY;

        // Extract target joint trajectory
        const simPoints: { x: number; y: number }[] = [];
        for (let t = 0; t < mech.joints.length; t++) {
          const j = mech.joints[t][targetJointIndex];
          if (j) simPoints.push({ x: j.x, y: j.y });
        }
        if (simPoints.length < 10) return PENALTY;

        return computeTrajectoryError(simPoints, targetPoints);
      } catch {
        return PENALTY;
      }
    };

    this.running = true;
    this.shouldStop = false;
    this.isRunning$.next(true);
    this.progress$.next(null);

    const F = 0.8, CR = 0.9;

    // Initialize population
    const population: number[][] = [];
    const fitness: number[] = [];
    for (let i = 0; i < popSize; i++) {
      const ind: number[] = [];
      for (let d = 0; d < dimension; d++) {
        ind.push(bounds[d].min + Math.random() * (bounds[d].max - bounds[d].min));
      }
      population.push(ind);
      fitness.push(evaluate(ind));
    }

    // Include current mechanism as one candidate (elitism)
    const currentParams: number[] = [];
    optimizableIds.forEach(id => {
      const j = joints.find((jt: any) => jt.id === id) as RealJoint;
      currentParams.push(j.x, j.y);
    });
    population[0] = currentParams;
    fitness[0] = evaluate(currentParams);

    let bestIdx = 0;
    for (let i = 1; i < popSize; i++) {
      if (fitness[i] < fitness[bestIdx]) bestIdx = i;
    }

    let gen = 0;
    const runGeneration = () => {
      if (this.shouldStop || gen >= maxGen) {
        this.finishOptimization(gen, fitness[bestIdx], population[bestIdx], mode);
        return;
      }
      gen++;

      for (let i = 0; i < popSize; i++) {
        let r1: number, r2: number, r3: number;
        do { r1 = Math.floor(Math.random() * popSize); } while (r1 === i);
        do { r2 = Math.floor(Math.random() * popSize); } while (r2 === i || r2 === r1);
        do { r3 = Math.floor(Math.random() * popSize); } while (r3 === i || r3 === r1 || r3 === r2);

        const jrand = Math.floor(Math.random() * dimension);
        const trial: number[] = [];
        for (let d = 0; d < dimension; d++) {
          if (Math.random() < CR || d === jrand) {
            let v = population[r1][d] + F * (population[r2][d] - population[r3][d]);
            v = Math.max(bounds[d].min, Math.min(bounds[d].max, v));
            trial.push(v);
          } else {
            trial.push(population[i][d]);
          }
        }
        const trialFit = evaluate(trial);
        if (trialFit <= fitness[i]) {
          population[i] = trial;
          fitness[i] = trialFit;
          if (trialFit < fitness[bestIdx]) bestIdx = i;
        }
      }

      this.progress$.next({
        generation: gen, bestError: fitness[bestIdx],
        bestParams: [...population[bestIdx]], mode,
      });

      if (fitness[bestIdx] <= 0.01) {
        this.finishOptimization(gen, fitness[bestIdx], population[bestIdx], mode);
        return;
      }
      setTimeout(runGeneration, 0);
    };
    setTimeout(runGeneration, 0);
  }

  // ===== Common =====

  private traceFourBarChain(inputGround: RealJoint, otherGround: RealJoint, freeJoints: RealJoint[]):
    { free1: RealJoint; free2: RealJoint } | null {
    const free1 = inputGround.connectedJoints.find(j =>
      j instanceof RealJoint && !((j as RealJoint).ground)
    ) as RealJoint | undefined;
    if (!free1) return null;
    const free2 = free1.connectedJoints.find(j =>
      j instanceof RealJoint && j.id !== inputGround.id && !((j as RealJoint).ground)
    ) as RealJoint | undefined;
    if (!free2) return null;
    if (!free2.connectedJoints.some(j => j.id === otherGround.id)) return null;
    return { free1, free2 };
  }

  private finishOptimization(gen: number, bestError: number, bestParams: number[], mode: 'GPU' | 'CPU'): void {
    this.running = false;
    this.shouldStop = false;
    this.isRunning$.next(false);
    this.progress$.next({ generation: gen, bestError, bestParams: [...bestParams], mode });
    NewGridComponent.sendNotification(`优化完成 [${mode}]！第${gen}代，误差: ${bestError.toFixed(4)}`);
  }

  stopOptimization(): void {
    this.shouldStop = true;
    // Don't destroy GPU evaluator here — let the loop exit cleanly and destroy it
  }

  applyBestResult(): void {
    const progress = this.progress$.value;
    if (!progress || !progress.bestParams) return;

    const joints = this.mechanismService.joints;
    const allRealJoints = joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const inputJoint = allRealJoints.find(j => j.input && j.ground);
    const optimizableJoints = allRealJoints.filter(j => j !== inputJoint);

    optimizableJoints.forEach((j, i) => {
      if (i * 2 + 1 < progress.bestParams.length) {
        j.x = progress.bestParams[i * 2];
        j.y = progress.bestParams[i * 2 + 1];
      }
    });

    this.mechanismService.updateMechanism();
    this.mechanismService.onMechUpdateState.next(3);
    NewGridComponent.sendNotification('已应用最优结果');
  }
}

/** Symmetric min-distance trajectory error */
function computeTrajectoryError(
  simulated: { x: number; y: number }[],
  target: { x: number; y: number }[]
): number {
  let sumT2S = 0;
  for (const tp of target) {
    let minD2 = Infinity;
    for (const sp of simulated) {
      const dx = tp.x - sp.x, dy = tp.y - sp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) minD2 = d2;
    }
    sumT2S += Math.sqrt(minD2);
  }
  let sumS2T = 0;
  for (const sp of simulated) {
    let minD2 = Infinity;
    for (const tp of target) {
      const dx = sp.x - tp.x, dy = sp.y - tp.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < minD2) minD2 = d2;
    }
    sumS2T += Math.sqrt(minD2);
  }
  return (sumT2S / target.length) + (sumS2T / simulated.length);
}
