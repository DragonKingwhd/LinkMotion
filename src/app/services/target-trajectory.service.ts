import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Coord } from '../model/coord';
import { TargetTrajectory } from '../model/target-trajectory';

const parseCSV = require('papaparse');

@Injectable({ providedIn: 'root' })
export class TargetTrajectoryService {
  private _trajectories: Map<string, TargetTrajectory> = new Map();

  public valueChanges = new Subject<void>();
  public isDrawing = new BehaviorSubject<boolean>(false);
  public drawingJointId: string | null = null;

  getTrajectory(jointId: string): TargetTrajectory | undefined {
    return this._trajectories.get(jointId);
  }

  getAllTrajectories(): TargetTrajectory[] {
    return Array.from(this._trajectories.values());
  }

  hasTrajectory(jointId: string): boolean {
    const traj = this._trajectories.get(jointId);
    return traj !== undefined && traj.points.length > 0;
  }

  startDrawing(jointId: string): void {
    // Clear existing trajectory for this joint before drawing new one
    this.ensureTrajectory(jointId);
    this._trajectories.get(jointId)!.clearPoints();
    this.drawingJointId = jointId;
    this.isDrawing.next(true);
    this.valueChanges.next();
  }

  stopDrawing(): void {
    this.drawingJointId = null;
    this.isDrawing.next(false);
    this.valueChanges.next();
  }

  addPoint(jointId: string, coord: Coord): void {
    this.ensureTrajectory(jointId);
    const traj = this._trajectories.get(jointId)!;

    // Distance-based filtering to avoid excessive points
    if (traj.points.length > 0) {
      const lastPoint = traj.points[traj.points.length - 1];
      const dist = lastPoint.getDistanceTo(coord);
      if (dist < 0.05) {
        return;
      }
    }

    traj.addPoint(coord);
    this.valueChanges.next();
  }

  setTrajectory(jointId: string, points: Coord[]): void {
    this.ensureTrajectory(jointId);
    const traj = this._trajectories.get(jointId)!;
    traj.points = points.map(p => p.clone());
    this.valueChanges.next();
  }

  clearTrajectory(jointId: string): void {
    const traj = this._trajectories.get(jointId);
    if (traj) {
      traj.clearPoints();
      this.valueChanges.next();
    }
  }

  clearAllTrajectories(): void {
    this._trajectories.clear();
    this.valueChanges.next();
  }

  importFromCSV(jointId: string, csvData: string): void {
    const result = parseCSV.parse(csvData, {
      header: false,
      dynamicTyping: true,
      skipEmptyLines: true,
    });
    const points: Coord[] = result.data
      .filter((row: any[]) => row.length >= 2 && !isNaN(row[0]) && !isNaN(row[1]))
      .map((row: any[]) => new Coord(row[0], row[1]));

    if (points.length > 0) {
      this.setTrajectory(jointId, points);
    }
  }

  private ensureTrajectory(jointId: string): void {
    if (!this._trajectories.has(jointId)) {
      this._trajectories.set(jointId, new TargetTrajectory(jointId));
    }
  }
}
