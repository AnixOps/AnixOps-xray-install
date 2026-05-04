# 速度与性能调优指南

## 速度测试

### 在线测速

访问以下网站测试你的节点速度：
- [Speedtest.net](https://www.speedtest.net)
- [Fast.com](https://fast.com)

### 终端测速

```bash
# 使用 speedtest-cli
pip install speedtest-cli
speedtest-cli

# 使用 curl 测试下载速度
curl -o /dev/null -w "%{speed_download} bytes/sec" https://speed.cloudflare.com/__down?bytes=104857600
```

## 影响速度的因素

### 1. 节点位置与你的距离

| 你的位置 | 推荐节点 | 预期延迟 |
|----------|----------|----------|
| 中国大陆东部 | 东京 | 30-60ms |
| 中国大陆南部 | 新加坡 | 40-80ms |
| 中国大陆西部 | 法兰克福 | 150-200ms |
| 北美 | 洛杉矶/西雅图 | 100-150ms |

**建议**: 选择物理距离最近的节点。

### 2. VPS 配置

| 配置 | 最低要求 | 推荐 |
|------|----------|------|
| CPU | 1 核 | 2 核 |
| 内存 | 1GB | 2GB |
| 带宽 | 1Gbps | 1Gbps+ |
| 月流量 | 1TB | 无限 |

AnixOps 默认使用 1C1G 配置，对于个人使用已足够。

### 3. 协议选择

- **VLESS Reality**: TCP 协议，延迟略高但稳定。适合对延迟不敏感的场景。
- **Hysteria2**: UDP (QUIC) 协议，延迟更低。适合游戏和高码率视频。

### 4. 网络拥塞

晚高峰（北京时间 20:00-24:00）期间，部分线路可能拥塞。如果速度明显下降：
- 尝试切换到其他区域的节点
- Hysteria2 在拥塞环境下表现优于 VLESS

## Hysteria2 性能调优

### 内核参数优化

AnixOps 已自动配置以下参数（见 `/etc/sysctl.d/99-hysteria.conf`）：

```ini
# UDP 缓冲区 (16MB)
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216
```

如果需要进一步提升性能，可以调整：

```bash
# 增大到 32MB
echo "net.core.rmem_max = 33554432" >> /etc/sysctl.d/99-hysteria.conf
echo "net.core.wmem_max = 33554432" >> /etc/sysctl.d/99-hysteria.conf
sysctl -p /etc/sysctl.d/99-hysteria.conf
```

### 带宽设置

Hysteria2 客户端配置中指定带宽可激活 Brutal 拥塞控制：

```json
{
  "bandwidth": {
    "up": "50 mbps",
    "down": "200 mbps"
  }
}
```

## VLESS Reality 性能调优

### 开启 BBR

AnixOps 默认开启 BBR 拥塞控制：

```bash
# 检查 BBR 状态
sysctl net.ipv4.tcp_congestion_control
# 应输出: net.ipv4.tcp_congestion_control = bbr
```

### 调整 gRPC 服务名

使用更长的 gRPC 路径可以减少被检测的概率，但对性能无影响。

## 常见问题

### Q: 为什么速度比预期慢？

1. 检查节点位置是否距离你太远
2. 检查 VPS 带宽是否有限制（部分云厂商对低价套餐限速）
3. 尝试 Hysteria2 协议（在弱网环境下通常更快）

### Q: 为什么延迟高？

延迟主要由物理距离决定。选择更近的节点或使用 Hysteria2 协议可以降低延迟。

### Q: 多人共享会影响速度吗？

按租模式下 IP 是独享的，不会影响速度。自托管模式下如果多人共用一台 VPS，速度取决于 VPS 带宽。
