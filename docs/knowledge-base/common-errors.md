# Common Errors

## 部署失败排查

### VPS 创建失败

**可能原因**:
- API Key 无效或权限不足
- 选择的区域没有库存
- 账户余额不足

**解决方案**:
1. 检查云供应商控制台确认 API Key 有效
2. 尝试其他区域
3. 确认账户有足够余额

### DNS 解析不生效

**可能原因**:
- Cloudflare Token 没有 DNS 编辑权限
- 域名不在 Cloudflare 管理

**解决方案**:
1. 确认 Token 有 `Zone:DNS:Edit` 权限
2. 确认域名已添加到 Cloudflare

### TLS 证书签发失败

**可能原因**:
- DNS 记录未生效
- Let's Encrypt 限流

**解决方案**:
1. 等待 DNS 传播完成后重试
2. 查看 acme.sh 日志: `acme.sh --info -d yourdomain.com`

### 客户端连接失败

**可能原因**:
- 防火墙未开放端口
- Xray 服务未启动
- 配置参数错误

**解决方案**:
1. SSH 登录服务器检查: `systemctl status xray`
2. 检查日志: `journalctl -u xray -f`
3. 确认配置 UUID 和域名正确

---

## AI Agent 深度定制

如果遇到以上问题无法自行解决，可以联系我们的 AI Agent 专家服务:

- 一对一技术支持
- 多节点负载均衡配置
- 企业级路由方案
- 专属售后服务

<a href="https://github.com/your-org/anixops-ai-agent">前往 AI Agent 服务 →</a>
