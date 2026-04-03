import { Component } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { RevJoint } from '../../../model/joint';
import { RealLink } from '../../../model/link';
import { MechanismService } from '../../../services/mechanism.service';
import { UrlProcessorService } from '../../../services/url-processor.service';

interface JointDef { id: string; x: number; y: number; input?: boolean; ground?: boolean; }
interface LinkDef { id: string; joints: string[]; }

interface TemplateDef {
  name: string; category: string; description: string;
  // Either a pre-verified URL string OR joint/link definitions
  url?: string;
  joints?: JointDef[];
  links?: LinkDef[];
}

@Component({
  selector: 'app-templates',
  templateUrl: './templates.component.html',
  styleUrls: ['./templates.component.scss'],
})
export class TemplatesComponent {

  categories = ['基础四杆', '直线机构', '六杆机构', '特种机构'];

  templates: TemplateDef[] = [
    // ===== 基础四杆 (原有验证过的URL) =====
    {
      name: '四杆机构', category: '基础四杆', description: '最基本的平面连杆机构',
      url: '0P.TY.K,0.101.MA,A,0mv,0VU,0.GB,B,0e_,E6,0.GC,C,l1,WW,0.KD,D,qD,0Pk,0..YRAB,AB,Fe,Fe,0ix,08i,c5cae9,A,B,,.YRBC,BC,Fe,Fe,32,NJ,303e9f,B,C,,.YRCD,CD,Fe,Fe,nd,3P,0d125a,C,D,,...JBq',
    },
    {
      name: '曲柄滑块', category: '基础四杆', description: '旋转运动转换为直线往复运动',
      url: '0P.TY.K,0.101.MA,A,0mA,0c,0.GB,B,0Yt,bK,0.GC,C,il,H-,0.LD,D,il,H-,0..YRAB,AB,Fe,Fe,0fW,IN,c5cae9,A,B,,.YRBC,BC,Fe,Fe,4y,Rf,303e9f,B,C,,.YPCD,CD,Fe,0,0,0,,C,D,,...JAe',
    },
    // 新增四杆 (圆-圆交点精确求解坐标)
    {
      name: '曲柄摇杆', category: '基础四杆',
      description: '曲柄全周转动，摇杆往复摆动 (AB=2, BC=4.5, CD=3.5, AD=5)',
      // AB=2, BC=4.5, CD=3.5, AD=5 → s+l=2+5=7 ≤ p+q=4.5+3.5=8 ✓ Grashof, 最短=曲柄
      // B at 30°: B=(1.73, 1). C by circle-circle: B(1.73,1) r=4.5 ∩ D(5,0) r=3.5 → C=(5.50, 3.47)
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 1.73, y: 1 },
        { id: 'C', x: 5.50, y: 3.47 },
        { id: 'D', x: 5, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BC', joints: ['B', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },
    {
      name: '平行四边形', category: '基础四杆',
      description: '对边等长，输出与输入同向等速 (AB=CD=3, BC=AD=6)',
      // 精确构造: AB=CD=3, BC=AD=6
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 0, y: 3 },
        { id: 'C', x: 6, y: 3 },
        { id: 'D', x: 6, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BC', joints: ['B', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },
    {
      name: '双曲柄', category: '基础四杆',
      description: '两端全周转动 (AB=3, BC=3.5, CD=3, AD=2, 最短杆为机架)',
      // AD=2(最短), AB=3, BC=3.5, CD=3 → s+l=2+3.5=5.5 ≤ p+q=3+3=6 ✓
      // B at 45°: B=(2.12, 2.12). C by circle-circle: B(2.12,2.12) r=3.5 ∩ D(2,0) r=3 → C=(5.0, 0.13)
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 2.12, y: 2.12 },
        { id: 'C', x: 5.0, y: 0.13 },
        { id: 'D', x: 2, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BC', joints: ['B', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },

    // ===== 直线机构 (含追踪点展示直线特性) =====
    {
      name: '切比雪夫直线', category: '直线机构',
      description: '追踪点E(耦合杆中点)近似走直线 (AD=4, AB=2, BC=5, CD=5)',
      // A(0,0), D(4,0), AB=2, BC=CD=5. B at 60°: B=(1,1.73)
      // C by circle-circle: B(1,1.73) r=5 ∩ D(4,0) r=5 → C=(4.85, 4.93)
      // E = midpoint of B,C = (2.92, 3.33) ← 追踪点, 走直线
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 1, y: 1.73 },
        { id: 'E', x: 2.92, y: 3.33 },
        { id: 'C', x: 4.85, y: 4.93 },
        { id: 'D', x: 4, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BEC', joints: ['B', 'E', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },

    // ===== 六杆机构 (原有验证过的URL) =====
    {
      name: '瓦特 I 型', category: '六杆机构', description: '瓦特I型拓扑六杆机构',
      url: '0P.TY.K,0.101.MA,A,0Qh,0Kn,0.GB,B,0e1,9i,0.GC,C,bT,LF,0.GD,D,0G5,tZ,0.GE,E,V5,1_z,0.GF,F,1mM,1Gv,0.KG,G,1rt,0ey,0..YRAB,AB,Fe,Fe,0XM,05Z,c5cae9,A,B,,.YRBCD,BCD,Fe,Fe,06D,Sr,303e9f,B,C,D,,.YRDE,DE,Fe,Fe,7W,1RG,0d125a,D,E,,.YREF,EF,Fe,Fe,17j,1dx,B2DFDB,E,F,,.YRFCG,FCG,Fe,Fe,1PE,KQ,26A69A,F,C,G,,...JAp',
    },
    {
      name: '瓦特 II 型', category: '六杆机构', description: '瓦特II型拓扑六杆机构',
      url: '0P.TY.K,0.101.MA,A,0Vf,0Vd,0.GB,B,0mZ,08A,0.GC,C,06Y,LC,0.GD,D,1MR,J2,0.KE,E,rw,0j2,0.GF,F,2ic,ID,0.KG,G,2lk,0Zt,0..YRAB,AB,Fe,Fe,0e6,0Ju,c5cae9,A,B,,.YRBC,BC,Fe,Fe,0RY,6X,303e9f,B,C,,.YRCDE,CDE,Fe,Fe,ic,01d,0d125a,C,D,E,,.YRDF,DF,Fe,Fe,21X,Id,B2DFDB,D,F,,.YRFG,FG,Fe,Fe,2kA,08r,26A69A,F,G,,...JBm',
    },
    {
      name: '斯蒂芬森 III 型', category: '六杆机构', description: '斯蒂芬森III型六杆机构',
      url: '0P.TY.K,0.101.MA,A,0YP,0ce,0.GB,B,0cQ,0FI,0.GC,C,lC,1-,0.KD,D,ow,0U1,0.GE,E,033,D-,0.GF,F,Dc,nj,0.KG,G,1M0,GJ,0..YRAB,AB,Fe,Fe,0aP,0Qz,c5cae9,A,B,,.YRBCE,BCE,Fe,Fe,1w,E,303e9f,B,C,E,,.YRCD,CD,Fe,Fe,n3,0E1,0d125a,C,D,,.YREF,EF,Fe,Fe,5H,Vs,B2DFDB,E,F,,.YRFG,FG,Fe,Fe,np,X0,26A69A,F,G,,...JBe',
    },

    // ===== 特种机构 =====
    {
      name: '带耦合点四杆', category: '特种机构',
      description: '追踪点E在耦合杆上偏移，画出丰富的耦合曲线',
      // AB=2.24, BC=5, CD=3.61, AD=5. E偏移在BC延长方向上方
      // B at (1,2): AB=2.24. C by circle-circle: B(1,2) r=5 ∩ D(5,0) r=3.61 → C=(4.5,1.5) 需验证
      // BC=sqrt(12.25+0.25)=3.54, CD=sqrt(0.25+2.25)=1.58 ← 不对, 需重算
      // 用已知有效的四杆: A(0,0), B(1.73,1), C(5.5,3.47), D(5,0) (同曲柄摇杆)
      // E在BC上方偏移: E = B + 0.5*(C-B) + 旋转90°的 0.3*(C-B)
      // mid=(3.615,2.235), perp方向=(-2.47,3.77)归一化×1.2 = (-0.66,1.01)
      // E ≈ (2.96, 3.24)
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 1.73, y: 1 },
        { id: 'E', x: 2.96, y: 3.24 },
        { id: 'C', x: 5.50, y: 3.47 },
        { id: 'D', x: 5, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BEC', joints: ['B', 'E', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },
    {
      name: '快回机构', category: '特种机构',
      description: '短曲柄+长连杆，工进慢回快 (AB=1.5, BC=5.5, CD=4, AD=5)',
      // AB=1.5, BC=5.5, CD=4, AD=5 → s+l=1.5+5.5=7 ≤ p+q=4+5=9 ✓
      // B at 45°: B=(1.06, 1.06). C by circle-circle: B(1.06,1.06) r=5.5 ∩ D(5,0) r=4
      // d=sqrt(15.52+1.12)=4.08, a=(30.25-16+16.65)/(2*4.08)=30.9/8.16=3.787
      // h²=30.25-14.34=15.91, h=3.99
      // P=(1.06,1.06)+0.928*(3.94,-1.06)=(4.716,-0.024)
      // perp of (3.94,-1.06): (1.06,3.94), norm=(0.26,0.966)
      // C=P+3.99*(0.26,0.966)=(5.75,3.83) or (3.68,-3.88)
      joints: [
        { id: 'A', x: 0, y: 0, input: true, ground: true },
        { id: 'B', x: 1.06, y: 1.06 },
        { id: 'C', x: 5.75, y: 3.83 },
        { id: 'D', x: 5, y: 0, ground: true },
      ],
      links: [
        { id: 'AB', joints: ['A', 'B'] },
        { id: 'BC', joints: ['B', 'C'] },
        { id: 'CD', joints: ['C', 'D'] },
      ],
    },
  ];

  constructor(
    private dialogRef: MatDialogRef<TemplatesComponent>,
    private mechanismService: MechanismService,
    private urlProcessor: UrlProcessorService,
  ) {}

  getTemplatesByCategory(category: string): TemplateDef[] {
    return this.templates.filter(t => t.category === category);
  }

  openLinkage(template: TemplateDef) {
    if (template.url) {
      // Load URL-encoded mechanism in current page
      this.urlProcessor.updateFromURL(template.url);
      this.dialogRef.close();
    } else if (template.joints && template.links) {
      // Programmatic build in current tab
      this.buildMechanism(template.joints, template.links);
      this.dialogRef.close();
    }
  }

  private buildMechanism(jointDefs: JointDef[], linkDefs: LinkDef[]) {
    this.mechanismService.joints = [];
    this.mechanismService.links = [];
    this.mechanismService.forces = [];

    const jointMap: { [id: string]: RevJoint } = {};
    for (const jd of jointDefs) {
      const j = new RevJoint(jd.id, jd.x, jd.y, !!jd.input, !!jd.ground);
      j.showCurve = true;
      jointMap[jd.id] = j;
    }

    // Set connectedJoints from link topology
    for (const ld of linkDefs) {
      for (let i = 0; i < ld.joints.length; i++) {
        for (let k = 0; k < ld.joints.length; k++) {
          if (i !== k) {
            const ji = jointMap[ld.joints[i]];
            const jk = jointMap[ld.joints[k]];
            if (ji && jk && !ji.connectedJoints.includes(jk)) {
              ji.connectedJoints.push(jk);
            }
          }
        }
      }
    }

    // Build links
    for (const ld of linkDefs) {
      const ljoints = ld.joints.map(jid => jointMap[jid]).filter(Boolean);
      if (ljoints.length >= 2) {
        const link = new RealLink(ld.id, ljoints);
        for (const j of ljoints) {
          if (!j.links.includes(link)) j.links.push(link);
        }
        this.mechanismService.links.push(link);
      }
    }

    this.mechanismService.joints = Object.values(jointMap);
    this.mechanismService.updateMechanism(true);
  }
}
