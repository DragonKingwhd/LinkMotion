import { Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { RealJoint } from '../../model/joint';
import { MechanismService } from '../../services/mechanism.service';
import { TargetTrajectoryService } from '../../services/target-trajectory.service';
import { OptimizerService } from '../../services/optimizer.service';
import { NewGridComponent } from '../new-grid/new-grid.component';
import { Subscription } from 'rxjs';

interface MechanismChecks {
  hasLinks: boolean;
  hasGround: boolean;
  hasInput: boolean;
  hasFreeJoint: boolean;
  validDof: boolean;
}

@Component({
  selector: 'app-synthesis-panel',
  templateUrl: './synthesis-panel.component.html',
  styleUrls: ['./synthesis-panel.component.scss'],
})
export class SynthesisPanelComponent implements OnDestroy {
  @ViewChild('trajCSVFile') trajCSVFile!: ElementRef<HTMLInputElement>;
  @ViewChild('step0') step0El!: ElementRef;
  @ViewChild('step1') step1El!: ElementRef;
  @ViewChild('step2') step2El!: ElementRef;
  @ViewChild('step3') step3El!: ElementRef;
  @ViewChild('step4') step4El!: ElementRef;

  selectedJointId: string | null = null;
  previewJointId: string | null = null;
  currentStep = 0;
  dissolvingStep: number | null = null;
  completedSteps: { [key: number]: boolean } = {};
  checks: MechanismChecks = { hasLinks: false, hasGround: false, hasInput: false, hasFreeJoint: false, validDof: false };

  optimizeForm = this.fb.group({ searchRadius: ['5'] });

  private subs: Subscription[] = [];
  private checkInterval: any;

  constructor(
    private fb: FormBuilder,
    public mechanismSrv: MechanismService,
    public trajectoryService: TargetTrajectoryService,
    public optimizerService: OptimizerService,
  ) {
    // Poll mechanism state to update checklist (user edits in another tab)
    this.checkInterval = setInterval(() => this.updateChecks(), 500);

    // Watch trajectory changes → auto-advance step 2→3
    this.subs.push(
      this.trajectoryService.valueChanges.subscribe(() => {
        if (this.currentStep === 2 && this.hasTrajectory()) {
          setTimeout(() => this.completeStep(2), 600);
        }
      })
    );

    // Watch optimizer finish → auto-advance step 3→4
    this.subs.push(
      this.optimizerService.isRunning$.subscribe(running => {
        if (!running && this.currentStep === 3 && this.getProgress()?.bestError < 1e5) {
          setTimeout(() => this.completeStep(3), 400);
        }
      })
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    clearInterval(this.checkInterval);
  }

  updateChecks(): void {
    const joints = this.mechanismSrv.joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const links = this.mechanismSrv.links;

    this.checks = {
      hasLinks: links.length >= 2,
      hasGround: joints.some(j => j.ground),
      hasInput: joints.some(j => j.input),
      hasFreeJoint: joints.some(j => !j.ground),
      validDof: this.getDof() === 1,
    };

    // Auto-advance step 0 when all checks pass
    if (this.currentStep === 0 && this.allChecksPassed()) {
      this.completeStep(0);
    }
  }

  allChecksPassed(): boolean {
    return this.checks.hasLinks && this.checks.hasGround && this.checks.hasInput
      && this.checks.hasFreeJoint && this.checks.validDof;
  }

  getDof(): number {
    if (this.mechanismSrv.mechanisms.length > 0 && this.mechanismSrv.mechanisms[0]) {
      return this.mechanismSrv.mechanisms[0].dof;
    }
    return NaN;
  }

  getSelectableJoints(): RealJoint[] {
    return this.mechanismSrv.joints.filter(j =>
      j instanceof RealJoint && !(j as RealJoint).ground
    ) as RealJoint[];
  }

  previewJoint(id: string): void {
    this.previewJointId = id;
  }

  confirmJoint(): void {
    if (!this.previewJointId) return;
    this.selectedJointId = this.previewJointId;
    this.previewJointId = null;
    setTimeout(() => this.completeStep(1), 300);
  }

  selectJoint(id: string): void {
    this.selectedJointId = id;
    setTimeout(() => this.completeStep(1), 300);
  }

  /**
   * A joint traces only a circular arc if it's directly connected to a ground joint.
   * Coupler points (not connected to any ground) can trace complex curves.
   */
  isArcOnlyJoint(jointId: string): boolean {
    const joints = this.mechanismSrv.joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const joint = joints.find(j => j.id === jointId);
    if (!joint) return false;
    // Check if any connected joint is a ground joint
    return joint.connectedJoints.some(cj =>
      cj instanceof RealJoint && (cj as RealJoint).ground
    );
  }

  hasTrajectory(): boolean {
    return !!this.selectedJointId && this.trajectoryService.hasTrajectory(this.selectedJointId);
  }

  getPointCount(): number {
    if (!this.selectedJointId) return 0;
    const t = this.trajectoryService.getTrajectory(this.selectedJointId);
    return t ? t.pointCount : 0;
  }

  startDraw(): void {
    if (!this.selectedJointId) return;
    this.trajectoryService.startDrawing(this.selectedJointId);
    NewGridComponent.instance.enterTrajectoryDrawMode();
  }

  clickCSVInput(): void {
    this.trajCSVFile?.nativeElement?.click();
  }

  importCSV(event: any): void {
    if (!this.selectedJointId) return;
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.trajectoryService.importFromCSV(this.selectedJointId!, reader.result as string);
      NewGridComponent.sendNotification('已导入轨迹');
    };
    reader.readAsText(file);
    event.target.value = '';
  }

  hasAnyTrajectory(): boolean {
    return this.trajectoryService.getAllTrajectories().some(t => t.points.length > 0);
  }

  clearAllTrajectories(): void {
    this.trajectoryService.clearAllTrajectories();
    NewGridComponent.sendNotification('已清除所有轨迹');
  }

  clearTrajectory(): void {
    if (!this.selectedJointId) return;
    this.trajectoryService.clearTrajectory(this.selectedJointId);
  }

  startOptimize(): void {
    if (!this.selectedJointId) return;
    const radius = parseFloat(this.optimizeForm.value.searchRadius || '5') || 5;
    this.optimizerService.startOptimization(this.selectedJointId, { searchRadius: radius });
  }

  stopOptimize(): void {
    this.optimizerService.stopOptimization();
  }

  getProgress(): any {
    return this.optimizerService.progress$.value;
  }

  getOptJointInfo(): { name: string; xMin: number; xMax: number; yMin: number; yMax: number }[] {
    const radius = parseFloat(this.optimizeForm.value.searchRadius || '5') || 5;
    const joints = this.mechanismSrv.joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const inputJoint = joints.find(j => j.input && j.ground);
    return joints
      .filter(j => j !== inputJoint)
      .map(j => ({
        name: j.name,
        xMin: j.x - radius,
        xMax: j.x + radius,
        yMin: j.y - radius,
        yMax: j.y + radius,
      }));
  }

  getFixedJointNames(): string {
    const joints = this.mechanismSrv.joints.filter(j => j instanceof RealJoint) as RealJoint[];
    const fixed = joints.filter(j => j.input && j.ground);
    return fixed.map(j => j.name).join(', ') || '无';
  }

  applyResult(): void {
    this.optimizerService.applyBestResult();
    this.completeStep(4);
  }

  resetGuide(): void {
    this.currentStep = 0;
    this.dissolvingStep = null;
    this.completedSteps = {};
    this.selectedJointId = null;
    this.previewJointId = null;
    this.optimizerService.progress$.next(null);
    this.updateChecks();
    // If mechanism is already valid, auto-advance
    if (this.allChecksPassed()) {
      setTimeout(() => this.completeStep(0), 300);
    }
  }

  completeStep(step: number): void {
    if (this.completedSteps[step]) return;
    this.dissolvingStep = step;
    const stepEl = this.getStepElement(step);
    if (stepEl) this.spawnParticles(stepEl);
    setTimeout(() => {
      this.completedSteps[step] = true;
      this.dissolvingStep = null;
      if (step < 4) {
        this.currentStep = step + 1;
      }
    }, 700);
  }

  private getStepElement(step: number): HTMLElement | null {
    switch (step) {
      case 0: return this.step0El?.nativeElement;
      case 1: return this.step1El?.nativeElement;
      case 2: return this.step2El?.nativeElement;
      case 3: return this.step3El?.nativeElement;
      case 4: return this.step4El?.nativeElement;
      default: return null;
    }
  }

  private spawnParticles(container: HTMLElement): void {
    const rect = container.getBoundingClientRect();
    const parent = container.parentElement!;
    const parentRect = parent.getBoundingClientRect();

    for (let i = 0; i < 28; i++) {
      const particle = document.createElement('div');
      particle.className = 'particle';

      const startX = rect.left - parentRect.left + Math.random() * rect.width;
      const startY = rect.top - parentRect.top + Math.random() * rect.height;
      const angle = Math.random() * Math.PI * 2;
      const distance = 30 + Math.random() * 90;

      particle.style.cssText = `
        left: ${startX}px;
        top: ${startY}px;
        --dx: ${Math.cos(angle) * distance}px;
        --dy: ${Math.sin(angle) * distance}px;
        --size: ${3 + Math.random() * 5}px;
        --delay: ${Math.random() * 0.15}s;
        background: hsl(${210 + Math.random() * 30}, 70%, ${55 + Math.random() * 25}%);
      `;

      parent.appendChild(particle);
      setTimeout(() => particle.remove(), 900);
    }
  }
}
