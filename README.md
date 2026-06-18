# WiFi 热力图 (WiFi Heatmap)

手持手机走一圈，自动生成家中 WiFi 信号覆盖热力图。

## 功能

- **手动画户型** — 在手机上绘制家中房间布局，支持墙体和路由器位置标记
- **自动信号采集** — 利用手机传感器（加速度计 + 陀螺仪）推算行人位置，边走边自动记录 WiFi 信号强度
- **热力图生成** — IDW（反距离加权）空间插值，将离散采样点渲染为连续热力图
- **数据持久化** — 所有数据存储在本地，无云端上传

## 截图

> [待补充]

## 技术栈

- React Native 0.86 (CLI, 非 Expo)
- TypeScript
- `@shopify/react-native-skia` — 画布渲染
- `react-native-wifi-reborn` — WiFi 信号扫描
- `react-native-sensors` — 惯性导航
- Zustand — 状态管理
- AsyncStorage — 本地持久化

## 兼容性

| 平台 | 支持情况 |
|------|----------|
| Android (含华为/HMS) | ✅ 完全支持 |
| iOS | ❌ 暂不支持（iOS WiFi API 受限） |

### 华为手机专项说明

本 App **不依赖 GMS (Google Mobile Services)**，可在华为手机上正常运行。

华为 EMUI 用户请确保：
1. 系统设置 → 应用 → WifiHeatmap → 权限 → 位置信息设为「**精确位置**」
2. 关闭省电模式对该 App 的后台限制，以保证传感器持续采集

## 快速开始

```bash
# 安装依赖
npm install

# 连接 Android 设备或启动模拟器，然后：
npx react-native run-android
```

## 编译环境要求

- Node.js >= 22
- Java 17+
- Android SDK (API 34+)
- Android NDK (需用于 `@shopify/react-native-skia`)

## 项目结构

```
src/
├── components/        # 可复用 UI 组件
├── screens/           # 页面
│   ├── HomeScreen.tsx            # 项目列表
│   ├── FloorPlanEditor.tsx       # 户型编辑器
│   ├── WifiScannerScreen.tsx     # WiFi 扫描
│   └── HeatmapViewer.tsx         # 热力图查看
├── services/          # 核心引擎
│   ├── WifiScanner.ts            # WiFi 扫描器
│   ├── PedestrianTracker.ts      # 行人航位推算 (PDR)
│   └── HeatmapEngine.ts          # IDW 插值 + 颜色映射
├── store/             # Zustand 状态管理
├── types/             # TypeScript 类型定义
└── i18n/              # 国际化（当前中文，保留扩展接口）
```

## 开源协议

MIT License

## 贡献

欢迎提交 Issue 和 PR。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。
