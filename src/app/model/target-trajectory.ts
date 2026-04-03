import { Coord } from './coord';

export class TargetTrajectory {
  points: Coord[] = [];
  jointId: string;
  color: string = '#FF5722';
  visible: boolean = true;

  constructor(jointId: string, points: Coord[] = [], color: string = '#FF5722') {
    this.jointId = jointId;
    this.points = points;
    this.color = color;
  }

  get pathString(): string {
    if (this.points.length < 2) {
      return '';
    }
    let d = 'M' + this.points[0].x + ',' + this.points[0].y;
    for (let i = 1; i < this.points.length; i++) {
      d += 'L' + this.points[i].x + ',' + this.points[i].y;
    }
    return d;
  }

  get pointCount(): number {
    return this.points.length;
  }

  addPoint(coord: Coord): void {
    this.points.push(coord.clone());
  }

  clearPoints(): void {
    this.points = [];
  }
}
