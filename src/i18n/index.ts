/**
 * i18n placeholder — currently Chinese-only.
 * To add a new language:
 *  1. Add a new language object (e.g., `en`)
 *  2. Add a language switcher in settings
 *  3. Replace direct string usage with `t('key')`
 */

export const zh = {
  app: {
    title: 'WiFi 热力图',
    subtitle: '信号覆盖可视化工具',
  },
  home: {
    noProjects: '还没有项目',
    noProjectsHint: '点击下方按钮创建第一个项目',
    newProject: '新建项目',
    create: '创建',
    cancel: '取消',
    delete: '删除',
    deleteConfirm: (name: string) => `确定删除「${name}」吗？此操作不可撤销。`,
    rooms: (n: number) => `${n} 个房间`,
    samples: (n: number) => `${n} 个采样点`,
  },
  editor: {
    addRoom: '+ 房间',
    editRoom: '编辑房间',
    deleteRoom: '删除',
    save: '保存',
    name: '名称',
    type: '类型',
    width: '宽 (cm)',
    height: '深 (cm)',
    setRouter: '标记路由器',
    selectRouterRoom: '选择路由器所在房间',
    startScan: '开始扫描',
    viewHeatmap: '查看热力图',
    alertNoRooms: '请先添加至少一个房间',
    alertNoRouter: '请先标记路由器位置',
  },
  scan: {
    scanning: '扫描中...',
    paused: '已暂停',
    exit: '退出',
    pause: '暂停',
    resume: '继续',
    finish: '完成',
    calibrate: '校准点',
    signalStrength: '信号强度',
    steps: '步数',
    samples: '采样点',
    calibrateRecorded: '校准点已记录',
    permissionTitle: '需要位置权限',
    permissionMsg:
      'Android 系统要求获取位置权限才能扫描 WiFi 信号。\n\n请在系统设置中允许本应用获取「精确位置」。',
    retry: '重试',
    later: '稍后设置',
  },
  heatmap: {
    title: '热力图',
    addSamples: '补采样',
    excellent: '极强',
    good: '强',
    fair: '一般',
    weak: '弱',
    samplePoints: '采样点',
    heatmapCells: '热力图格',
    avgRssi: '平均 RSSI (dBm)',
    rescan: '再扫一次',
    export: '导出截图',
  },
};

export type I18nDict = typeof zh;
