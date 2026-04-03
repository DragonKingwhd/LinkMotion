# LinkMotion - 平面连杆机构运动仿真与轨迹优化平台

基于 [PMKS+](https://github.com/PMKS-Web/PMKSWeb) 的增强版本，新增轨迹设计、自动优化等核心功能。

## 核心功能

### 继承自 PMKS+
- 交互式创建和编辑平面连杆机构
- 运动学分析（位置、速度、加速度）
- 力分析（静力/动力）
- 动画播放与控制
- 链接分享与导入/导出

### LinkMotion 新增
- **目标轨迹绘制** — 手绘或导入CSV目标运动曲线
- **差分进化优化器** — 自动搜索最优关节位置，使实际轨迹贴合目标
- **WebGPU 加速** — 并行评估候选机构（需在 chrome://flags 启用 WebGPU）
- **引导式轨迹设计** — 步骤化引导，完成即消散的粒子动效
- **智能关节提示** — 自动识别弧线关节 vs 耦合点，推荐最佳追踪目标
- **扩充模板库** — 13种经典机构模板（四杆、直线、六杆、特种）
- **全面汉化** — 完整中文界面

## 快速开始

### 环境要求
- Node.js 18+
- npm 8+

### 本地部署

```bash
# 克隆仓库
git clone https://github.com/DragonKingwhd/LinkMotion.git
cd LinkMotion

# 安装依赖
npm install

# 启动开发服务器
npm start

# 浏览器访问
# http://localhost:4200/
```

### 构建生产版本

```bash
npm run build
# 输出目录: dist/pmksweb/
# 可部署到任意静态文件服务器（Nginx、Netlify、Vercel等）
```

## 使用流程

```
1. 创建机构 → 右键画布添加关节和连杆，或从模板库加载
2. 设计面板  → 选择目标关节 → 手绘期望轨迹
3. 自动优化  → 设置搜索范围 → 开始优化 → 观察误差下降
4. 应用结果  → 停止优化 → 应用最优参数到机构
5. 验证动画  → 播放动画，对比实际轨迹与目标轨迹
```

## 技术架构

| 层级 | 技术 |
|------|------|
| 前端框架 | Angular 15 + TypeScript |
| UI组件 | Angular Material |
| 渲染 | SVG (svg.js + svg-pan-zoom) |
| 图表 | ApexCharts |
| 优化算法 | 差分进化 (DE/rand/1/bin) |
| GPU加速 | WebGPU Compute Shader (WGSL) |

## 项目结构

```
src/app/
├── model/                    # 数据模型
│   ├── mechanism/            # 机构求解器（位置/运动学/力/瞬心）
│   ├── target-trajectory.ts  # 目标轨迹模型
│   ├── joint.ts / link.ts    # 关节/连杆模型
│   └── coord.ts              # 2D坐标类
├── services/                 # 服务层
│   ├── mechanism.service.ts  # 机构状态管理
│   ├── target-trajectory.service.ts  # 轨迹管理
│   ├── optimizer.service.ts  # DE优化器
│   ├── gpu-evaluator.ts      # WebGPU并行评估
│   └── ...
├── component/                # UI组件
│   ├── new-grid/             # SVG画布
│   ├── synthesis-panel/      # 轨迹设计面板（引导式）
│   ├── edit-panel/           # 属性编辑面板
│   ├── analysis-panel/       # 分析图表面板
│   └── MODALS/templates/     # 模板库
└── workers/                  # Web Worker（备用）
```

## 致谢

- [PMKS+](https://github.com/PMKS-Web/PMKSWeb) — 原始项目，MIT许可证
- Prof. Matthew I. Campbell — PMKS 原始开发者
- WPI PMKS+ 团队 — Angular 重写与教育功能

## 许可证

[MIT License](LICENSE) — 基于 PMKS+ 原始 MIT 许可证
