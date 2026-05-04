# 客户端配置教程

## VLESS Reality 客户端

### Windows - V2RayN

1. 下载 [V2RayN](https://github.com/2dust/v2rayN/releases)
2. 复制 VLESS 分享链接
3. 在 V2RayN 中: `服务器` → `从剪切板批量导入 URL`
4. 测试连接: 双击服务器，点击 `测试真连接延迟`

### macOS / iOS - Shadowrocket

1. 安装 [Shadowrocket](https://apps.apple.com/app/shadowrocket/id932747118)
2. 复制 VLESS 分享链接
3. 在 Shadowrocket 中: `+` → `从剪贴板导入`
4. 测试连接

### Android - Clash Meta (v2rayNG)

1. 下载 [v2rayNG](https://github.com/2dust/v2rayng/releases)
2. 复制 VLESS 分享链接
3. 在 v2rayNG 中: `+` → `从剪贴板导入 URL`

### 全平台 - Clash Meta

1. 下载 Clash Meta 客户端:
   - Windows: [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev)
   - macOS: Clash Verge Rev
   - Android: Clash Meta for Android
   - iOS: Stash
2. 导入 Clash Meta YAML 配置
3. 启用代理

## Hysteria2 客户端

### Windows - Nekoray

1. 下载 [Nekoray](https://github.com/MatsuriDayo/nekoray/releases)
2. 复制 Hysteria2 分享链接
3. 在 Nekoray 中: `+` → `从剪贴板导入`

### Android - Hiddify / Nekobox

1. 下载 [Hiddify](https://github.com/hiddify/hiddify-next/releases) 或 [NekoBox](https://github.com/MatsuriDayo/NekoBoxForAndroid/releases)
2. 复制 Hysteria2 分享链接
3. 导入配置

### iOS - Shadowrocket

Shadowrocket 支持 Hysteria2:
1. 复制 Hysteria2 分享链接
2. Shadowrocket → `+` → `从剪贴板导入`

### 全平台 - Sing-box

1. 安装 Sing-box
2. 导入 Sing-box JSON 配置
3. 启动服务

## 分享链接格式

### VLESS Reality

```
vless://UUID@IP:443?encryption=none&security=reality&type=grpc&serviceName=随机路径&sni=addons.mozilla.org&pbk=公钥&sid=随机短ID&fp=chrome#AnixOps
```

### Hysteria2

```
hysteria2://user:密码@IP:443/?insecure=1&obfs=salamander&obfs-password=混淆密码#AnixOps
```

## 常见问题

### Q: 为什么连接显示 "失败"？

1. 确认配置中的 IP、端口、UUID/密码正确
2. 确认服务器已完全启动（部署完成后等待 1-2 分钟）
3. 尝试重新导入配置

### Q: 为什么浏览器无法打开网页？

1. 确认系统代理已开启
2. 确认 PAC/全局路由模式已选择
3. 尝试切换代理模式（全局 vs PAC）

### Q: Clash 配置导入后无法使用？

1. 确认使用的是 Clash **Meta** 内核（原版 Clash 不支持 VLESS 和 Hysteria2）
2. 查看日志确认错误信息
