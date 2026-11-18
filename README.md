# Clip for DeepSeek Harness

**简体中文** · [English](https://github.com/Ant-wkp/dsh-clip-for-agent/blob/main/README.en.md)

用 reSpeaker Clip 录音，DSH 在录音期间显示波形，停录后通过本机 SenseVoice 转写到聊天草稿。录音模式可在 Clip 面板选择：RTC 通过 BLE 实时接收 Opus，SD 模式先录到设备，再在停录后同步。

## 方式一：应用内「插件管理」

在 Web 或 Electron 桌面版打开 **插件 → 添加插件**，填写以下 GitHub 地址。也可通过 npm 安装，填写 `dsh-clip-for-agent`。[npm 包页面](https://www.npmjs.com/package/dsh-clip-for-agent)

```text
git+https://github.com/Ant-wkp/dsh-clip-for-agent.git#v0.3.9
```

安装后启用插件。如界面提示重启，重启后在左侧栏打开 **Clip**。

## 方式二：命令行

| 你使用的界面 | Profile |
| --- | --- |
| `dsh web`（浏览器） | `web` |
| Electron 桌面应用 | `desktop` |

使用桌面应用时，先启动一次以初始化 `desktop` profile，再从应用自带的 DSH 终端运行命令。网页和桌面各选一条：

```bash
dsh plugin --profile web add 'git+https://github.com/Ant-wkp/dsh-clip-for-agent.git#v0.3.9'
dsh plugin --profile desktop add 'git+https://github.com/Ant-wkp/dsh-clip-for-agent.git#v0.3.9'
```

安装后启动或重启对应的 DSH 界面，并在插件管理中确认 Clip 已启用。

如果 `dsh --version` 显示 Dancer's Shell，Web 版可以用 `npx @deepseek-ai/dsh@0.2.2-rc.1` 或 `npx @deepseek-ai/dsh@0.2.2-rc.3` 代替命令中的 `dsh`。请选择与你现有 DSH Web 相同的版本。

## 方式三：从源码安装

```bash
git clone --branch v0.3.9 https://github.com/Ant-wkp/dsh-clip-for-agent.git
cd dsh-clip-for-agent
npm run build
```

然后按实际使用的界面选择一条命令：

```bash
# Linux · DSH Web
dsh plugin --profile web add "file:$(pwd)"
```

```powershell
# Windows PowerShell · Electron 桌面版自带的 DSH 终端
dsh plugin --profile desktop add "file:$($PWD.Path)"
```

`file:` 后填包含 `package.json` 和 `cordis.patch.yml` 的插件目录绝对路径。`npm run build` 生成 `lib/client.js`，使用仓库随附的 Windows 和 Linux x64 设备进程。

## 使用 Clip

1. 在 DSH 左侧栏打开 **Clip**，点击 **扫描设备**，为设备选择 **配对连接**。
2. 在 **Clip → 录音结果 → 录音模式** 选择「RTC 实时音频」或「SD 录音」。默认使用 RTC，选择会在当前浏览器或桌面端记住。回到要录入的聊天，点击输入栏的 Clip 麦克风按钮开始录音。也可在 Clip 面板开始。
3. 点击停止，或通过设备支持的实体按键停录。RTC 在录制期间接收音频，收到结束帧后解码；SD 在停录后下载设备文件再解码。两种模式都通过本机 SenseVoice 转写。若仍在原聊天且草稿未变化，转写插入录音开始时的光标位置。否则可从结果手动插入。
4. RTC 流开始 120 秒后会自动停录。蓝牙中途断开或缺少结束帧时需要重录。SD 录音可在重新连接后重试同步，也可手动选择 **同步最近 SD 录音**。

首次使用时，在 **Clip → 语音转写** 点击 **安装 SenseVoice 模型**，同一位置会显示下载进度。如果官方转写组件未启用，点击 **安装官方转写** 会在 Clip 面板发起安装或启用。DSH 需要重启才能加载组件时，面板会显示提示。模型缓存和官方语音插件共用。若已启用官方语音输入 bundle，Clip 复用已加载的官方服务和本地 SenseVoice。语音输入支持每段最多 120 秒，转写只写草稿，需要用户手动发送。
