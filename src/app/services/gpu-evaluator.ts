/**
 * WebGPU-accelerated parallel mechanism evaluation for DE optimization.
 *
 * Each GPU workgroup independently solves one candidate four-bar mechanism:
 *   1. Rotate input link B around ground joint A (360 steps of 1°)
 *   2. Solve C position via circle-circle intersection (B,rBC) ∩ (D,rCD)
 *   3. Store target joint trajectory
 *   4. Compute symmetric min-distance error vs target trajectory
 */

const WGSL_SHADER = /* wgsl */`

struct Uniforms {
  groundAx: f32, groundAy: f32,
  groundDx: f32, groundDy: f32,
  targetJointIdx: u32,   // 1=B(free1), 2=C(free2)
  numTargetPoints: u32,
  numCandidates: u32,
  _pad: u32,
}

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> candidates: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> targetTraj: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> simTraj: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read_write> fitness: array<f32>;
@group(0) @binding(5) var<storage, read_write> simSteps: array<u32>;

const MAX_STEPS: u32 = 400u;
const PI: f32 = 3.14159265358979;
const PENALTY: f32 = 1000000.0;
const TOLERANCE: f32 = 0.008;

@compute @workgroup_size(1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= u.numCandidates) { return; }

  let cand = candidates[idx];
  let A = vec2<f32>(u.groundAx, u.groundAy);
  let D = vec2<f32>(u.groundDx, u.groundDy);
  var B = vec2<f32>(cand.x, cand.y);
  var C = vec2<f32>(cand.z, cand.w);

  // Compute link lengths from initial configuration
  let rAB = distance(A, B);
  let rBC = distance(B, C);
  let rCD = distance(C, D);

  // Degenerate check
  if (rAB < 0.001 || rBC < 0.001 || rCD < 0.001) {
    fitness[idx] = PENALTY;
    simSteps[idx] = 0u;
    return;
  }

  var theta = atan2(B.y - A.y, B.x - A.x);
  let angleStep = PI / 180.0;
  let baseOffset = idx * MAX_STEPS;
  let startB = B;

  var numSteps = 0u;

  for (var step = 0u; step < MAX_STEPS; step++) {
    theta = theta + angleStep;

    // Rotate B around A
    B = A + rAB * vec2<f32>(cos(theta), sin(theta));

    // Solve C: circle-circle intersection
    let dx = D.x - B.x;
    let dy = D.y - B.y;
    let dist = sqrt(dx * dx + dy * dy);

    if (dist > rBC + rCD || dist < abs(rBC - rCD) || dist < 0.0001) {
      fitness[idx] = PENALTY;
      simSteps[idx] = 0u;
      return;
    }

    let a = (rBC * rBC - rCD * rCD + dist * dist) / (2.0 * dist);
    let h2 = rBC * rBC - a * a;
    if (h2 < 0.0) {
      fitness[idx] = PENALTY;
      simSteps[idx] = 0u;
      return;
    }
    let h = sqrt(h2);

    let px = B.x + a * dx / dist;
    let py = B.y + a * dy / dist;

    let cx1 = px + h * dy / dist;
    let cy1 = py - h * dx / dist;
    let cx2 = px - h * dy / dist;
    let cy2 = py + h * dx / dist;

    // Pick solution closest to previous C
    let d1 = (cx1 - C.x) * (cx1 - C.x) + (cy1 - C.y) * (cy1 - C.y);
    let d2 = (cx2 - C.x) * (cx2 - C.x) + (cy2 - C.y) * (cy2 - C.y);
    if (d1 <= d2) {
      C = vec2<f32>(cx1, cy1);
    } else {
      C = vec2<f32>(cx2, cy2);
    }

    // Store target joint position
    if (u.targetJointIdx == 1u) {
      simTraj[baseOffset + step] = B;
    } else {
      simTraj[baseOffset + step] = C;
    }
    numSteps = step + 1u;

    // Convergence: B returned to start?
    if (step > 10u) {
      let bd = distance(B, startB);
      if (bd < TOLERANCE) {
        break;
      }
    }
  }

  simSteps[idx] = numSteps;

  if (numSteps < 10u) {
    fitness[idx] = PENALTY;
    return;
  }

  // --- Compute trajectory error (symmetric min-distance) ---

  // Target → Simulated
  var sumT2S: f32 = 0.0;
  for (var t = 0u; t < u.numTargetPoints; t++) {
    let tp = targetTraj[t];
    var minD: f32 = 1e10;
    for (var s = 0u; s < numSteps; s++) {
      let sp = simTraj[baseOffset + s];
      let dd = distance(tp, sp);
      if (dd < minD) { minD = dd; }
    }
    sumT2S += minD;
  }

  // Simulated → Target
  var sumS2T: f32 = 0.0;
  for (var s = 0u; s < numSteps; s++) {
    let sp = simTraj[baseOffset + s];
    var minD: f32 = 1e10;
    for (var t = 0u; t < u.numTargetPoints; t++) {
      let tp = targetTraj[t];
      let dd = distance(tp, sp);
      if (dd < minD) { minD = dd; }
    }
    sumS2T += minD;
  }

  fitness[idx] = sumT2S / f32(u.numTargetPoints) + sumS2T / f32(numSteps);
}
`;

export interface GpuConfig {
  groundA: { x: number; y: number };
  groundD: { x: number; y: number };
  targetJointIdx: number; // 1=B, 2=C
  targetTrajectory: { x: number; y: number }[];
  maxPopulation: number;
}

const MAX_STEPS = 400;
const MAX_TARGET_POINTS = 2048;

export class GpuEvaluator {
  private device!: GPUDevice;
  private pipeline!: GPUComputePipeline;
  private uniformBuffer!: GPUBuffer;
  private candidateBuffer!: GPUBuffer;
  private targetTrajBuffer!: GPUBuffer;
  private simTrajBuffer!: GPUBuffer;
  private fitnessBuffer!: GPUBuffer;
  private simStepsBuffer!: GPUBuffer;
  private readbackBuffer!: GPUBuffer;
  private bindGroup!: GPUBindGroup;
  private maxPop: number;
  private numTargetPoints: number;

  private constructor() {
    this.maxPop = 0;
    this.numTargetPoints = 0;
  }

  static async create(config: GpuConfig): Promise<GpuEvaluator | null> {
    if (!navigator.gpu) {
      console.warn('WebGPU not supported');
      return null;
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.warn('No GPU adapter found');
      return null;
    }

    const evaluator = new GpuEvaluator();

    try {
      evaluator.device = await adapter.requestDevice();
      evaluator.maxPop = config.maxPopulation;
      evaluator.numTargetPoints = Math.min(config.targetTrajectory.length, MAX_TARGET_POINTS);

      // Create shader module
      const shaderModule = evaluator.device.createShaderModule({ code: WGSL_SHADER });

      // Create pipeline
      evaluator.pipeline = evaluator.device.createComputePipeline({
        layout: 'auto',
        compute: { module: shaderModule, entryPoint: 'main' },
      });

      // Create buffers
      const pop = config.maxPopulation;

      evaluator.uniformBuffer = evaluator.device.createBuffer({
        size: 32, // 8 floats = 32 bytes
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });

      evaluator.candidateBuffer = evaluator.device.createBuffer({
        size: pop * 16, // 4 floats × 4 bytes per candidate
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      evaluator.targetTrajBuffer = evaluator.device.createBuffer({
        size: Math.max(8, evaluator.numTargetPoints * 8), // 2 floats × 4 bytes per point
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });

      evaluator.simTrajBuffer = evaluator.device.createBuffer({
        size: pop * MAX_STEPS * 8, // 2 floats × 4 bytes per step per candidate
        usage: GPUBufferUsage.STORAGE,
      });

      evaluator.fitnessBuffer = evaluator.device.createBuffer({
        size: pop * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      evaluator.simStepsBuffer = evaluator.device.createBuffer({
        size: pop * 4,
        usage: GPUBufferUsage.STORAGE,
      });

      evaluator.readbackBuffer = evaluator.device.createBuffer({
        size: pop * 4,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      });

      // Upload target trajectory
      const targetData = new Float32Array(evaluator.numTargetPoints * 2);
      for (let i = 0; i < evaluator.numTargetPoints; i++) {
        targetData[i * 2] = config.targetTrajectory[i].x;
        targetData[i * 2 + 1] = config.targetTrajectory[i].y;
      }
      evaluator.device.queue.writeBuffer(evaluator.targetTrajBuffer, 0, targetData);

      // Upload uniforms
      const uniformData = new ArrayBuffer(32);
      const f32 = new Float32Array(uniformData);
      const u32 = new Uint32Array(uniformData);
      f32[0] = config.groundA.x;
      f32[1] = config.groundA.y;
      f32[2] = config.groundD.x;
      f32[3] = config.groundD.y;
      u32[4] = config.targetJointIdx;
      u32[5] = evaluator.numTargetPoints;
      u32[6] = 0; // numCandidates - set per dispatch
      u32[7] = 0; // pad
      evaluator.device.queue.writeBuffer(evaluator.uniformBuffer, 0, uniformData);

      // Create bind group
      evaluator.bindGroup = evaluator.device.createBindGroup({
        layout: evaluator.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: evaluator.uniformBuffer } },
          { binding: 1, resource: { buffer: evaluator.candidateBuffer } },
          { binding: 2, resource: { buffer: evaluator.targetTrajBuffer } },
          { binding: 3, resource: { buffer: evaluator.simTrajBuffer } },
          { binding: 4, resource: { buffer: evaluator.fitnessBuffer } },
          { binding: 5, resource: { buffer: evaluator.simStepsBuffer } },
        ],
      });

      return evaluator;
    } catch (err) {
      console.error('WebGPU initialization failed:', err);
      return null;
    }
  }

  async evaluatePopulation(candidates: number[][]): Promise<number[]> {
    const numCandidates = candidates.length;

    // Upload candidate parameters
    const candData = new Float32Array(numCandidates * 4);
    for (let i = 0; i < numCandidates; i++) {
      candData[i * 4 + 0] = candidates[i][0]; // xB
      candData[i * 4 + 1] = candidates[i][1]; // yB
      candData[i * 4 + 2] = candidates[i][2]; // xC
      candData[i * 4 + 3] = candidates[i][3]; // yC
    }
    this.device.queue.writeBuffer(this.candidateBuffer, 0, candData);

    // Update numCandidates in uniform
    const u32 = new Uint32Array([numCandidates]);
    this.device.queue.writeBuffer(this.uniformBuffer, 24, u32); // offset 24 = 6th u32

    // Dispatch compute
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup);
    pass.dispatchWorkgroups(numCandidates);
    pass.end();

    // Copy fitness to readback buffer
    encoder.copyBufferToBuffer(this.fitnessBuffer, 0, this.readbackBuffer, 0, numCandidates * 4);

    this.device.queue.submit([encoder.finish()]);

    // Read back results
    await this.readbackBuffer.mapAsync(GPUMapMode.READ);
    const result = new Float32Array(this.readbackBuffer.getMappedRange(0, numCandidates * 4));
    const fitness = Array.from(result);
    this.readbackBuffer.unmap();

    return fitness;
  }

  destroy(): void {
    this.uniformBuffer?.destroy();
    this.candidateBuffer?.destroy();
    this.targetTrajBuffer?.destroy();
    this.simTrajBuffer?.destroy();
    this.fitnessBuffer?.destroy();
    this.simStepsBuffer?.destroy();
    this.readbackBuffer?.destroy();
    this.device?.destroy();
  }
}
