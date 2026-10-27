# 语音转文字（全离线 · SenseVoice-Small · 连续识别）

本地 **FunASR SenseVoice-Small** + 浏览器前端。  
**已切断** Chrome Web Speech 在线识别；麦克风音频只送到本机 `127.0.0.1:8765`。

## 环境

- Windows 11（也可用 Linux/macOS）
- Python 3.10+（安装时勾选 Add to PATH）
- Node.js 18+（仅首次构建前端需要；若已有 `static/` 可跳过）
- 磁盘：模型约 **0.3–0.9 GB** + PyTorch/FunASR 依赖
- 可选 NVIDIA GPU（自动 `cuda:0`；否则 CPU）

## 一键启动

```bat
start.bat
```

浏览器打开 http://127.0.0.1:8765 （更新后请 **Ctrl+F5**）

可选超时（秒，默认 90）：

```bat
set ASR_TIMEOUT_SEC=120
start.bat
```

## 行为说明（连续 ASR）

- 点「开始连续聆听」后**麦克风一直开着**，按讲话节奏断句
- **静音约 0.8–1.2 秒**（界面可调，默认 **1000 ms**）切成一句，立刻交给 SenseVoice
- 识别某一句时**仍继续录音**；下一段进入短队列（默认最多 8 句，满则丢最旧）
- 每条结果旁显示**识别用时**
- **超时保护**：单次识别超过 `ASR_TIMEOUT_SEC`（默认 90s）返回中文错误；前端另有看门狗（超时+15s）；连续会话一般可继续说
- 「打断/丢弃」：停麦并丢弃当前缓冲与排队

## 目录

- `server/` — FastAPI + WebSocket ASR（SenseVoice，连续队列）
- `frontend/` — React/Vite 源码
- `static/` — 构建后的页面
- `models/` — 仅 `.gitkeep`。权重不在仓库里，下载后位于 `models/SenseVoiceSmall/`
- `requirements.txt` — Python 依赖

## 模型

仓库不含 SenseVoice 权重（约 0.3–0.9 GB）。名称：`iic/SenseVoiceSmall`（ModelScope）/ `FunAudioLLM/SenseVoiceSmall`（HF）。

首次使用需要联网下载：

```bat
python scripts\download_sensevoice.py
```

`start.bat` 在缺少 `models\SenseVoiceSmall` 时也会自动执行该脚本。

## 开发模式

终端 1：`start.bat`  
终端 2：`cd frontend && npm run dev` → http://localhost:5173
