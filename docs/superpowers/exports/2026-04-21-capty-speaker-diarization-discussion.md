# Capty Speaker Diarization 讨论纪要

**日期:** 2026-04-21  
**项目:** Capty sidecar  
**主题:** ASR + Speaker Diarization 方案选择与落地设计

## 讨论背景

我们围绕 Capty sidecar 当前的 ASR 实现，讨论了以下问题：

1. 当前 `transcribe_sync(...)` 的职责和限制是什么
2. `mlx-audio` 是否支持 Speaker Diarization
3. `Qwen3-ASR` 是否原生支持 Speaker Diarization
4. 当前业界一般怎样做 Speaker Diarization
5. Capty 应该采用什么实现方案

最后确认的目标方案是：

- `ASR(Qwen / Whisper / Parakeet)` 负责文字
- `pyannote` 负责 diarization
- 用词级时间戳做 reconciliation
- 输出 `segments[{start,end,speaker,text}]`

## 一、当前 sidecar 里的 ASR 函数结论

我们先分析了 [engine.py](/Users/zhangjie/Documents/Jeason的创作/code/personal/capty/sidecar/capty_sidecar/engine.py) 里的：

```python
def transcribe_sync(self, audio_pcm: bytes, sample_rate: int = DEFAULT_SAMPLE_RATE) -> str:
    """Transcribe PCM audio. MUST run on MLX thread."""
    if not self.is_loaded():
        raise RuntimeError("ASR model not loaded")
    audio_float = pcm_bytes_to_float32(audio_pcm)
    result = self._model.generate(audio_float)
    return result.text if result else ""
```

核心结论：

- 这是 ASR 引擎的最底层同步转录入口
- 输入是原始 PCM bytes，不是 MP3/WAV 文件路径
- 它会把 `int16 PCM` 转成 `float32 [-1, 1]`
- 然后调用底层模型的 `generate(...)`
- 当前实现只返回 `result.text`
- 如果模型有 `segments / timestamps / speaker_id` 等结构化信息，这一层会直接丢掉
- `sample_rate` 参数当前没有真正被使用

因此，当前 sidecar 的 ASR 设计只适合“纯文本返回”，不适合直接承载 diarization。

## 二、`mlx-audio` 是否支持 Speaker Diarization

结论分两层：

### 1. `mlx-audio` 这个库本身支持

讨论中确认：

- `mlx-audio` 有专门的 diarization / VAD 路线
- `VibeVoice-ASR` 可以带 speaker 信息
- `Sortformer` 是 `mlx-audio` 里专门的 diarization 方向

而且本地安装的 `mlx_audio` 代码里，`STTOutput` 已经为 `speaker_id` 留了口子，说明框架层本身接受这种结构化结果。

### 2. Capty 当前 sidecar 封装不支持

虽然库层支持，但 Capty 当前这层封装：

- `ASREngine.transcribe_sync(...)` 只返回字符串
- `/v1/audio/transcriptions` 最终也只返回 `{"text": ...}`

所以即便底层模型支持 speaker labels，当前 sidecar 也拿不到。

## 三、`Qwen3-ASR` 是否支持 Speaker Diarization

我们的结论是：

- **`Qwen3-ASR` 不算原生支持 Speaker Diarization**
- 它的官方能力重点是：
  - ASR
  - 语言识别
  - 时间戳 / 对齐能力
- 但 speaker diarization 不是它的标准输出能力

因此，如果坚持使用 Qwen 路线，正确做法不是“等它直接吐出 speaker”，而是：

1. `Qwen3-ASR` 负责生成文字
2. `Qwen3-ForcedAligner` 负责把文字对齐回音频，拿到词级时间戳
3. `pyannote` 负责 speaker turns
4. 再把词级时间戳和 speaker turns 做 reconciliation

这个结论后来直接成为最终架构的基础。

## 四、业界一般怎么做 Speaker Diarization

我们讨论后的归纳是：

### 1. 最常见的做法不是单模型一把梭

更常见的是组合式 pipeline：

- ASR 负责文字
- alignment / word timestamps 负责时间
- diarization 模型负责“谁在什么时候说”
- 最后做对齐融合

### 2. 不同场景的常见选择

- **离线高精度 diarization**：`pyannote`
- **实时 / streaming diarization**：NVIDIA Sortformer 一类方案
- **云 API 一体化**：AssemblyAI / Deepgram / Soniox

### 3. 如果问“谁做得最好”

我们给出的结论是按场景看：

- 专项 diarization 能力：`pyannoteAI` 很强
- 开源 / 自托管默认方案：`pyannote community-1`
- 实时工程化路线：`NVIDIA Streaming Sortformer`

由于 Capty 当前是本地 sidecar 设计，且你明确接受引入 `torch`，所以最终更适合走 `pyannote` 路线。

## 五、最终确认的 Capty 方案

你确认接受的方案是：

- `ASR(Qwen/Whisper/Parakeet)` 负责文字
- `pyannote` 负责 diarization
- 用词级时间戳做 reconciliation
- 输出 `segments[{start,end,speaker,text}]`

这意味着我们不采用：

- 只依赖 `VibeVoice-ASR`
- 只依赖 `mlx-audio` 内部 diarization
- 直接让 Qwen 自己做 speaker attribution

## 六、为什么选这条方案

这个方案的优势是：

1. **ASR 和 diarization 解耦**
   - 以后切换 Qwen / Whisper / Parakeet，不影响 diarization 后端

2. **统一输出模型**
   - 不管底层 ASR 模型不同，最终都能整理成统一的 `words / speaker_turns / segments`

3. **工程上更稳**
   - `pyannote` 是成熟 diarization 方案
   - ASR 各走各的最佳时间戳路径

4. **后续扩展空间大**
   - 以后可以接入 `pyannoteAI`
   - 也可以增加 `Sortformer` 作为本地 fallback

## 七、Capty 里的具体落地设计

我们后来把方案收敛成了一个明确设计。

### 1. 新增一个 annotated file transcription 接口

不直接改坏现有接口，而是新增：

- `POST /v1/audio/transcribe-file-annotated`

这样可以：

- 保持 `/v1/audio/transcriptions` 兼容
- 保持 `/v1/audio/transcribe-file` 兼容
- 在新接口里返回更完整的结构化结果

### 2. 统一内部数据结构

新增 canonical 中间表示：

- `WordSpan`
- `SpeakerTurn`
- `TranscriptSegment`

这层是整个方案的关键，因为它把：

- Whisper 的 word timestamps
- Parakeet 的 aligned tokens
- Qwen + forced aligner 的结果
- pyannote 的 speaker turns

统一进同一个内部接口。

### 3. 各模型的时间戳策略

#### Whisper

- 直接用原生 `word_timestamps=True`

#### Parakeet

- 用原生 `AlignedResult.sentences / tokens`

#### Qwen

- `Qwen3-ASR` 只负责出文字
- `Qwen3-ForcedAligner` 负责出词级时间戳

### 4. `pyannote` 的运行方式

我们明确决定：

- 不把 `pyannote` 放进 MLX 线程
- 单独加 `torch_executor.py`
- 用一个独立的 Torch executor 跑 diarization

原因：

- MLX 和 Torch 是两套执行体系
- `pyannote` 本身是 Torch 路线
- 这样不会污染当前 MLX 线程模型

### 5. reconciliation 逻辑

核心逻辑是：

1. ASR 先给出词级时间戳
2. pyannote 给出 speaker turns
3. 对每个词，计算它和所有 speaker turn 的 overlap
4. 选择 overlap 最大的 speaker
5. 再把相邻、同 speaker 的词合并成最终 segment

最后得到：

```json
{
  "text": "...",
  "words": [
    {"text": "Hello", "start": 0.42, "end": 0.81, "speaker": "SPEAKER_00"}
  ],
  "speaker_turns": [
    {"speaker": "SPEAKER_00", "start": 0.31, "end": 1.40}
  ],
  "segments": [
    {"speaker": "SPEAKER_00", "start": 0.42, "end": 1.13, "text": "Hello there"}
  ]
}
```

## 八、实现层面的关键改动

我们把实现分成了几块：

### 1. `engine.py`

- 保留旧的文本接口
- 增加结构化 ASR 输出能力
- 新增 `AlignerEngine`

### 2. `engine_pool.py`

- 现有 slot：`asr` / `tts`
- 新增 slot：`aligner`

### 3. `torch_executor.py`

- 新增单独的 Torch 执行器
- 专门给 pyannote 使用

### 4. `diarization.py`

- 封装 pyannote pipeline 的加载和调用

### 5. `reconcile.py`

- 做 `WordSpan + SpeakerTurn -> TranscriptSegment`

### 6. `server.py`

- 新增 `/v1/audio/transcribe-file-annotated`
- 保持旧接口兼容

### 7. `main.py`

- 增加 alignment / diarization 模型目录配置

### 8. `pyproject.toml` 和 PyInstaller

因为你已经明确表示“不需要受当前 torch 排除约束限制”，所以方案里接受：

- 加入 `torch`
- 加入 `torchaudio`
- 加入 `pyannote.audio`

同时打包配置也要跟着改。

## 九、当前已经形成的正式文档

我们已经把这个讨论收敛成两份正式文档：

### 1. 设计稿

[2026-04-19-sidecar-speaker-diarization-design.md](/Users/zhangjie/Documents/Jeason的创作/code/personal/capty/docs/superpowers/specs/2026-04-19-sidecar-speaker-diarization-design.md)

内容包括：

- 为什么选这个架构
- 新增接口定义
- 内部数据结构
- MLX / Torch 分层
- reconciliation 设计
- 打包影响和风险

### 2. 实施计划

[2026-04-19-sidecar-speaker-diarization.md](/Users/zhangjie/Documents/Jeason的创作/code/personal/capty/docs/superpowers/plans/2026-04-19-sidecar-speaker-diarization.md)

内容包括：

- 文件修改清单
- 分任务实施步骤
- 测试点
- 打包和验证要求

## 十、后续建议的实施顺序

如果继续推进实现，推荐顺序是：

1. 先做 `reconcile.py` 和 canonical types
2. 再做 `ASREngine` 的结构化输出
3. 然后接入 `AlignerEngine`
4. 再接 `pyannote` 和 `torch_executor`
5. 最后新增 annotated route
6. 再处理打包和测试

## 十一、当前结论的简版摘要

一句话总结：

> Capty 不应该把 speaker diarization 绑定在某一个 ASR 模型上，而应该采用 `ASR + word timestamps + pyannote + reconciliation` 的分层方案，统一输出 speaker-attributed transcript。

这是当前讨论后最稳、最可维护、最便于演进的路线。
