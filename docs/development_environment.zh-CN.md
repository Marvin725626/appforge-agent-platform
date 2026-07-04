# 本地开发环境

当前项目使用放在 `E:\agent\tools` 下的便携开发工具，不依赖系统全局安装：

- Node.js `v22.22.3`
- npm `10.9.8`
- Git for Windows `2.54.0.windows.1`

下载文件均来自官方发布源，并已使用官方 SHA-256 摘要校验。

## 在当前 PowerShell 会话中启用

进入项目目录后，使用 Dot Sourcing 执行环境脚本：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
. .\scripts\use-local-tools.ps1
```

`Set-ExecutionPolicy -Scope Process` 只对当前 PowerShell 会话生效，不会修改
系统或用户级执行策略。

第二条命令开头的点和空格不能省略。这样脚本设置的 `PATH` 和 npm 缓存目录才会
保留在当前 PowerShell 会话中。

随后可以验证：

```powershell
node --version
npm --version
git --version
```

npm 缓存会写入项目根目录的 `.npm-cache`，该目录已加入 `.gitignore`。
