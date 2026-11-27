# SWE 类基准用于 stable-ptc-eval 与普通 PTC 的真实模型 A/B：核验与选型

> 核验日期：2026-11-27。范围仅限 SWE-bench Verified/Lite、SWE-bench-Live、SWE-rebench V2、SWE-bench Pro、SWE-smith。
>
> 方法：只使用官方论文、官方 GitHub/Hugging Face、官方文档与官方数据接口；未运行真实模型，未下载大型数据集，也未修改实现。网页和持续更新数据集可能变化，正式实验必须再固定 revision 与镜像 digest。
>
> 标记约定：**[事实]** 是可由所引 primary source 直接支持的陈述；**[判断]** 是针对本次 PTC A/B 的选型、风险或实验设计建议。许可证部分是工程核验，不是法律意见。

## 1. 先给结论

### 1.1 推荐的最小子集

**[判断]** 本次是比较“插件自带 stable-ptc-eval preset 的渐进披露”与普通 PTC，不是训练模型，也不是重新发布综合 coding leaderboard。最小而有区分度的组合是：

| 用途 | 推荐集合 | 为什么保留 | 不应怎样解释 |
|---|---|---|---|
| 开发组 | **SWE-bench Verified 500** | 人工确认可解、官方 Docker harness 成熟、500 题足以支持配对 A/B；任务和工具生态与现有 PTC 评测接近 | 公开且较旧，绝对分数不能称为“无污染能力” |
| 实验保留组 | **SWE-bench-Live lite 300，冻结 revision 和实例 ID** | 300 个冻结题，覆盖 2024-10 至 2025-03；与开发组不同，且比不断增长的全集更可复现 | 只是“本次实验未用于调参”的保留组，不自动等于预训练无污染 |
| 压力测试 | **SWE-bench Pro V2 hard / HARD-51** | 51 题，官方 V2 已做 gold/empty 双向门禁，agent 离线、独立 fresh-sandbox 重评协议更严格 | 由若干净模型家族的失败题筛出，有选择偏差；只报压力结果，不估计总体能力 |

**[判断]** 暂不纳入最小 A/B：

- **SWE-bench Lite**：与 Verified 同源于原 SWE-bench test，增加一组旧 Python 题的边际信息有限；不能把二者当独立保留组。需要低成本冒烟时，可用其官方 dev 23 条检查基础设施，但不据此选模型或 preset。
- **SWE-rebench V2**：主要价值是大规模、多语言训练环境和诊断元数据；32,079 题及 26.36 TiB 镜像远超本次最小 A/B 所需，而且官方明确警告与其他基准有重叠。
- **SWE-smith**：定位是训练数据生成工具/训练集，任务是合成 bug 与 LM 生成 issue，不是自然真实 issue 的独立评测；与本次“不训练、只 A/B”目标不匹配。
- **Pro commercial / held-out**：不公开，不能作为默认可获得、可重分发数据集纳入；没有正式访问渠道时不能假定可用。

**[判断]** 若已知被测模型训练截止日，并且 Live lite 不晚于该截止日，应从 Live full 选择**截止日之后**的一个固定月度批次（或分层抽样）作为时间保留组，冻结 ID、revision 和镜像 digest；若截止日未知，只能称“实验保留”，不能称“时间外/无污染”。

### 1.2 “全部固定 commit、有测试、可隔离、无私有依赖”是过度概括

**[事实+判断]** 前两项大体描述了 SWE-bench 风格数据，但不能推出后两项，更不能无例外覆盖 SWE-smith：

| 数据集 | 固定代码状态 | 测试/oracle | 隔离与私有依赖边界 |
|---|---|---|---|
| Verified / Lite | 有 base_commit，另有 environment_setup_commit | 有 test_patch、F2P/P2P | Docker 可复现不等于断网；官方 FAQ 仍有构建联网故障说明，镜像字段也不等于 digest 固定 |
| SWE-bench-Live | 有 base_commit | 有 test_patch、F2P/P2P、逐例镜像 | 数据卡只说 51 个修正实例使用 immutable digest，其余保留默认镜像引用；运行协议禁止查答案，但不是统一的 no-network 证明 |
| SWE-rebench V2 | 有 base_commit | 有 test_patch，至少一个 F2P，连续三次结果一致才保留 | 设计目标是镜像内含依赖、运行时不联网安装；论文仍列出 external dependencies、private registry/credential 等诊断或失败因素，需逐例验证 |
| SWE-bench Pro V2 | 有 base_commit，镜像内 git history 已清理 | 有隐藏 test_patch、F2P/P2P；gold 全过、empty 全不过 | **agent 阶段**断网，但官方明确说少数 Go 任务在 setup/verifier 阶段会下载模块；不能把整次评测称为完全离线 |
| SWE-smith | 当前 HF schema 无 base_commit；论文对 PR Mirror 明确“不检出 PR base commit” | 用 bug patch 使**既有、原本通过的测试**失败，不是统一提供新 test_patch | 同仓库任务共享 Docker 环境；入库前只要求超过 80% 既有测试通过，不能推出全测试绿、完全隔离或无外部依赖 |

来源：[Lite 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite)、[Verified 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)、[Live 数据卡](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live)、[Rebench V2 论文 §3–4](https://arxiv.org/html/2602.23866)、[Pro V2 官方运行说明](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)、[SWE-smith 论文 §2.1](https://arxiv.org/html/2504.21798)、[SWE-smith 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-smith)。

## 2. 逐项核验

## 2.1 SWE-bench Lite 与 Verified

### 规模与时间覆盖

- **[事实]** 原 SWE-bench 从 12 个公开 Python 仓库约 90k PR 中筛出 2,294 个 issue–PR 任务；候选 PR 必须关联已解决 issue、修改测试，并通过安装/运行与 F2P 过滤。[原论文 §2.1](https://arxiv.org/html/2310.06770)
- **[事实]** Lite 有 **300 test + 23 dev**，test 来自 11 个 Python 仓库；Lite 的目标是较低成本、较自包含的功能 bug 修复，不是人工质量认证集。[Lite 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite)、[原论文 §2.4](https://arxiv.org/html/2310.06770)
- **[事实]** Verified 是原 test 中经人工质量验证的 **500** 题；人工流程筛除描述不清、测试不合理等样本，并尽量保留较难样本。[Verified 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)、[OpenAI 官方说明](https://openai.com/index/introducing-swe-bench-verified/)
- **[事实]** 按官方 HF 数据接口的 created_at（PR 创建时间）排序：Lite test 为 **2012-09-20 至 2023-07-17**；Verified 为 **2013-01-25 至 2023-08-07**。来源：[Lite 最早](https://datasets-server.huggingface.co/filter?dataset=SWE-bench%2FSWE-bench_Lite&config=default&split=test&orderby=%22created_at%22&offset=0&length=1)、[Lite 最晚](https://datasets-server.huggingface.co/filter?dataset=SWE-bench%2FSWE-bench_Lite&config=default&split=test&orderby=%22created_at%22%20DESC&offset=0&length=1)、[Verified 最早](https://datasets-server.huggingface.co/filter?dataset=SWE-bench%2FSWE-bench_Verified&config=default&split=test&orderby=%22created_at%22&offset=0&length=1)、[Verified 最晚](https://datasets-server.huggingface.co/filter?dataset=SWE-bench%2FSWE-bench_Verified&config=default&split=test&orderby=%22created_at%22%20DESC&offset=0&length=1)。
- **[事实]** Lite 与 Verified 都是同一原 test 的子集，而非独立采集。[Lite 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite)、[Verified 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)

### 环境、测试、依赖与凭证

- **[事实]** 每条包含 base_commit、非测试 gold patch、test_patch、F2P/P2P 与执行脚本；官方当前 harness 强制使用 Docker，在 fresh evaluation 中应用预测补丁和测试补丁。[数据卡](https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified)、[官方评估指南](https://www.swebench.com/SWE-bench/guides/evaluation/)
- **[事实]** 本地评估不需要云凭证，但需要 Docker、镜像/构建所需网络；Modal 是可选云路径，不是本地运行的强制依赖。官方建议 x86_64、至少 **120 GB 空余磁盘、16 GB RAM、8 CPU cores**，arm64 支持仍是 experimental。[官方仓库 README](https://github.com/SWE-bench/SWE-bench#-set-up)、[官方 FAQ](https://www.swebench.com/SWE-bench/faq/)
- **[判断]** “固定 base commit”不覆盖 base 镜像、apt/pip 包、latest tag 或测试工具链的漂移；正式 A/B 应固定 harness revision 和实际镜像 digest，并缓存依赖。模型 API 凭证与 Docker/Modal 凭证分开登记。

### 污染、许可与成本

- **[事实]** 原论文只证明“未来可用训练截止日之后的新 PR 更新”这一机制；现有 Lite/Verified 都是截至 2023 年的公开 PR，并未提供对当前模型的去污染保证。[原论文 §2.3、附录 A](https://arxiv.org/html/2310.06770)
- **[事实]** 官方仓库声明 MIT；原论文另列出 12 个上游仓库许可证并要求遵守原许可，Lite/Verified 当前 HF 卡片未给每实例许可证字段。[官方仓库许可说明](https://github.com/SWE-bench/SWE-bench#-citation--license)、[原论文许可证附录](https://arxiv.org/html/2310.06770)
- **[判断]** 不应把项目 MIT 理解为上游代码、issue、patch 和镜像都统一变成 MIT；重分发镜像或修改数据时，要携带相应上游 notice/license 并逐仓库检查。
- **[事实]** Lite 的 300 与 Verified 的 500 是官方为控制评估成本提供的规模，不是固定的美元价格；模型调用价格、上下文长度、重试与并发都会改变费用。[原论文 §2.4](https://arxiv.org/html/2310.06770)
- **[判断]** 本次双臂成本按 2 × 实例数 × 单实例模型成本，再加存储/计算估算；两臂必须同任务、同模型和解码参数、同 token/turn/time 上限。Verified 适合作开发组，Lite 只作可选冒烟，不另设“Lite vs Verified”的 A/B。

## 2.2 SWE-bench-Live

### 规模与时间覆盖

- **[事实]** 论文初版是 **1,319 题、93 个 Python 仓库**，issue 创建时间为 **2024-01-01 至 2025-04-20**；每题有独立 Docker 镜像。lite 从 **2024-10 至 2025-03** 每月抽 50，共 300。[官方论文 §3、§4](https://arxiv.org/html/2505.23419)
- **[事实]** 当前 Python HF 卡片列出 **test=1000、lite=300、verified=500、full=1888**；lite 与 verified 冻结，full 持续每月增加 50。这里的 Live verified 初版由 **LLM filter** 从 2024-07 至 2025-04 的实例筛出，不能误写成 OpenAI 式人工 Verified。[Live 数据卡及 News](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live)
- **[事实]** 当前主仓库还扩展到 MultiLang（2026-08 官方公告为 **1,077 题、431 repos、8 语言**）和 Windows（**66 题、48 repos、9 语言**）；这些与论文版 Python 数据集是不同配置，不能混算规模。[官方主仓库 README](https://github.com/microsoft/SWE-bench-Live#news)
- **[判断]** 本笔记推荐的是可复现的 Python lite 冻结集，不是把 Python/MultiLang/Windows 的数字相加。需要语言或 OS 压力测试时，应另立实验与预算。

### 环境、测试、依赖与凭证

- **[事实]** 字段包括 base_commit、gold/test patch、F2P/P2P、docker_image、rebuild_cmds 和 test_cmds；51 个环境修正实例用 immutable digest，其余保留默认 Linux 镜像引用。评测协议禁止 rollout 读取 gold、test patch、F2P、未来 commit 或网上答案。[Live 数据卡](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live)、[官方评估协议](https://github.com/microsoft/SWE-bench-Live#evaluation-protocol)
- **[事实]** 本地路径需要 Git、Python 3.12、Docker；环境构建工具 RepoLaunch 自动安装、构建和验证。论文的实验机器是 128 cores / 2 TB RAM，但这是作者实验配置，不是官方最低配置。[官方安装说明](https://github.com/microsoft/SWE-bench-Live#-set-up)、[官方论文计算资源说明](https://arxiv.org/html/2505.23419)
- **[判断]** 协议禁止“查答案”不等于技术层面的断网；应自行设置 no-network/仅模型端点 allowlist，清理 git refs，并在 verifier 阶段再测外部网络、服务与凭证需求。不能只凭 docker_image 字段判定完全离线。

### 污染、许可与成本

- **[事实]** 论文将 recency 和月度更新作为降低预训练污染的手段，初版只收 2024 年后的 issue；但已发布批次及答案仍是公开数据。[官方论文 §3.1、§4](https://arxiv.org/html/2505.23419)
- **[判断]** “contamination-resistant”不能升级为对任意未来模型的“contamination-free”。月度新增只在题目晚于模型训练截止且 rollout 查不到答案时提供更强时间证据；冻结老批次后，其新鲜度会下降。
- **[事实]** 代码仓库和 Python HF 卡片声明 MIT；论文的仓库筛选要求有效开源许可证，但当前数据 schema 没有逐实例 license 字段。[MIT LICENSE](https://github.com/microsoft/SWE-bench-Live/blob/main/LICENSE)、[Live 数据卡](https://huggingface.co/datasets/SWE-bench-Live/SWE-bench-Live)、[论文 §3.1](https://arxiv.org/html/2505.23419)
- **[判断]** 重分发仍需保留数据集 MIT notice，并审查上游代码/issue/patch/镜像许可，不能因聚合数据集标 MIT 就省略上游义务。
- **[事实]** 官方没有给出本次 A/B 可套用的单题美元成本；当前仓库只报告某次 856 issues/93 repos 环境构建优化节省 82% LM API cost 和 78% 镜像存储，而不是完整运行总价。[官方 News](https://github.com/microsoft/SWE-bench-Live#news)
- **[判断]** 适合作为实验保留组；冻结 300 题比持续变化的 full 更可复现。若需要最新时间外样本，则另冻结较新批次，不能一边滚动更新一边比较历史分数。

## 2.3 SWE-rebench V2

### 规模与时间覆盖

- **[事实]** V2 主集为 **32,079 题、3,617 repos、20 种语言**，任务覆盖 **2014–2025**；每条有 base_commit、gold/test patch、F2P/P2P、镜像名和 LLM 质量诊断。[官方论文摘要及 §3.7](https://arxiv.org/html/2602.23866)、[官方 HF 数据卡](https://huggingface.co/datasets/nebius/SWE-rebench-V2)
- **[事实]** 官方 collection 另有 **126,300** 条 SWE-rebench-V2-PRs。论文说明这类 PR-based 扩展提供安装说明、F2P 和元数据，problem statement 由 PR 描述和 patch 生成；不能把 126,300 与 32,079 个预构建、可执行镜像任务混为一谈。[官方 HF collection API](https://huggingface.co/api/collections/nebius/swe-rebench-v2)、[官方论文摘要及 §3.6](https://arxiv.org/html/2602.23866)
- **[事实]** 当前 V2 数据卡已提示后续 V2.1 RL 修复集；官方 builder README 也提供重验证版本。
- **[判断]** 32,079 是 V2 原始发布规模，不应理解为“全部已通过后续修复版标准”。[V2 数据卡](https://huggingface.co/datasets/nebius/SWE-rebench-V2)、[官方 builder README](https://github.com/SWE-rebench/SWE-rebench-V2#swe-rebench-v21)

### 环境、测试、依赖与凭证

- **[事实]** 候选来自公开、permissive-license 仓库的 merged PR，必须修改测试；环境镜像目标是在运行时无需联网安装。每个保留任务至少一个 F2P，并跑三次、结构化结果一致才保留。[官方论文 §3.1–3.3](https://arxiv.org/html/2602.23866)
- **[事实]** 论文仍列出 external dependencies、test brittleness、underspecification 等实例级诊断，以及 private registry/credential requirements 等常见构建失败。B3=EXTERNAL_DEPENDENCY 的精确定义是“必要信息只在 issue 未引用的外部 URL 中”，所以排除 B3 也不能替代运行时网络/凭证检查。[官方论文 §4 及附录诊断 prompt](https://arxiv.org/html/2602.23866)
- **[事实]** 本地评估需要 Python、Docker 和官方脚本；只有 annotation --send 模式需要 OpenAI API key。[官方 builder README](https://github.com/SWE-rebench/SWE-rebench-V2#requirements)
- **[判断]** 数据/代码公开不代表任意环境下都已验证匿名拉取每个镜像、无外部服务。[官方 builder README](https://github.com/SWE-rebench/SWE-rebench-V2#requirements)

### 污染、许可与成本

- **[事实]** 官方数据卡明确：只排除了原 SWE-bench 仓库，**没有显式过滤其他基准**；训练前应检查重叠并排除与评估基准重叠的任务。[V2 数据卡“Benchmark overlap”](https://huggingface.co/datasets/nebius/SWE-rebench-V2)
- **[判断]** 因时间跨到 2014–2025、且官方承认其他 benchmark overlap，V2 不能未经去重就当保留组；更适合训练/压力采样。即使排除原 SWE-bench repo，也不能替代对 Live、Pro 及其他多语言基准的去重。
- **[事实]** 数据集为 **CC BY 4.0**，构建代码为 **MIT**；每实例还带上游仓库当时 commit 的 SPDX license，数据卡要求遵守各上游许可。[HF 许可说明](https://huggingface.co/datasets/nebius/SWE-rebench-V2#license)、[代码 LICENSE](https://github.com/SWE-rebench/SWE-rebench-V2/blob/main/LICENSE)
- **[判断]** 重分发需同时满足 CC BY 署名、MIT notice 和逐上游许可；CC BY 不是对上游代码义务的豁免。
- **[事实]** 论文报告的**构建**成本：约 535k 次 setup model API calls、约 **$1.9k setup inference**；583,809 次 Docker builds、约 **26,400 job-hours**；最终 32,079 个环境共 **26.36 TiB**。HF 主数据本身下载量约 2.26 GB。以上不是一次模型 A/B 的运行成本。[论文 §3.7](https://arxiv.org/html/2602.23866)、[HF 数据卡元数据](https://huggingface.co/datasets/nebius/SWE-rebench-V2)
- **[判断]** 全量拉取和运行不适合本次最小实验。若后续做多语言压力集，只选固定分层小样本，排除 B3/B4 等不合格描述、运行时外部依赖和凭证任务，再执行 gold/empty 与重叠门禁；不要直接使用全部 32,079。

## 2.4 SWE-bench Pro（必须区分 V1 与 V2）

### 规模、可见性与时间覆盖

- **[事实]** 论文总集为 **1,865 题、41 repos**：public **731**（11 个 copyleft 开源仓库）、commercial **276**（18 个私有 startup 仓库）、held-out **858**（另 12 个仓库）。后两者不公开；commercial 因法律原因不能发布。[官方论文 §3.1、§3.3](https://arxiv.org/html/2509.16941v2)
- **[事实]** 当前默认公开数据已升级为 **V2：642 题、11 repos**，另有 **HARD-51**；原 731 保留为 v1 config / v1.0 tag。V2 删除 89 题，修改 529 条说明、214 个 test patches、38 个 gold patches，并修复 211 个镜像依赖。[V2 官方 README](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)、[HF 数据卡](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro)
- **[事实]** V2 public 覆盖 Go 256、Python 237、JS 145、TS 4。HARD-51 是五个模型家族中至少两个失败的题，再删 3 个歧义题后形成。[HF 数据卡](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro)、[V2 README](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md#hard-51)
- **[事实]** 当前数据 schema 没有 created_at，论文也未给 public 任务统一 PR 起止区间。因此只能报告发布版本时间，不能声称题目都属于某一固定历史窗口。[HF 数据卡字段](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro)、[官方论文](https://arxiv.org/html/2509.16941v2)

### 环境、测试、依赖与凭证

- **[事实]** V2 每题有 Harbor 目录、verifier、gold solution、隐藏 test patch 与公开 GHCR linux/amd64 镜像；镜像可匿名拉取，repo 位于固定 base_commit，并清掉 fixing commit、stray refs、stashes 和 hooks。[V2 README](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)
- **[事实]** release gate 报告 gold **642/642** resolved、empty **642/642** unresolved。协议给 agent 每题 50 分钟、只允许访问模型端点，捕获 diff 后在 pristine image 独立重评；但 setup/verifier 保留网络，少数 Go 任务测试时下载 modules。[V2 README “locked protocol”与“release gate”](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md#the-locked-protocol)
- **[事实]** 官方示例用 Harbor + Modal，需要 modal setup 和模型 API key；GHCR 镜像本身无需登录。V1 文档中的 local Docker beta 与 Docker Hub 是 legacy 路径，不能与 V2 指令混用。[官方主 README](https://github.com/scaleapi/SWE-bench_Pro-os#installation)、[V2 README](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)

### 污染、许可与成本

- **[事实]** 论文的 public/held-out 使用 copyleft，作者认为这降低进入专有训练语料的概率；commercial 则依靠私有访问降低污染。官方措辞和设计是“降低风险”，不是证明每个模型都未见过。[官方论文 §1、§3.2](https://arxiv.org/html/2509.16941v2)
- **[判断]** copyleft 不是技术去污染证明。V2 的 no-network 和 sanitized history 主要阻止 rollout 查答案，不能抹去预训练记忆；HARD-51 还经过模型表现选择，只能作压力集。
- **[事实]** V2 harness/tooling 为 MIT；task content（说明、patch、tests）仍受 11 个上游仓库各自许可证约束。commercial 内容不能公开再分发。[HF License](https://huggingface.co/datasets/ScaleAI/SWE-bench_Pro#license)、[代码 LICENSE](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/LICENSE)、[论文 §3.3](https://arxiv.org/html/2509.16941v2)
- **[判断]** Pro public 的重分发要重点审查 copyleft notice/source 义务，不要只附带 Scale 的 MIT 文件；私有 commercial/held-out 不应进入公共实验包或轨迹仓库。
- **[事实]** V2 每题 50 分钟是协议预算，不是美元价格；HARD-51 把每臂 rollout 数从 642 降为 51。论文旧实验曾采用 50 turns / $2 上限，那不是 V2 当前统一费用标准。[V2 README](https://github.com/scaleapi/SWE-bench_Pro-os/blob/main/v2/README.md)、[论文实验设置](https://arxiv.org/html/2509.16941v2)
- **[判断]** 适合压力测试，不作为最小主保留组；主结论不要被 51 个按失败选择的题主导。若跑 V2 全集，应先处理 Go verifier 联网例外并预留 Modal/镜像成本。

## 2.5 SWE-smith

### 规模与“时间覆盖”

- **[事实]** 论文数据集为 **50,137 题、128 个 Python repos**，平均 381 题/repo；任务由 LM Modify/Rewrite、程序化 AST 修改、组合 bug、PR Mirror 生成，issue 文本再由 LM 基于 bug patch、测试与输出生成。[官方论文 §2.1–2.2](https://arxiv.org/html/2504.21798)
- **[事实]** 当前 HF 卡片正文仍写 50,137，但结构化元数据列 **59,136**；主 README 又写“52k”。官方卡片另说 2025-12-14 后不再积极维护该 mono-repo，推荐语言拆分数据。[HF 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-smith)、[官方主 README](https://github.com/SWE-bench/SWE-smith#-resources)
- **[事实]** 论文的仓库池来自 **2024-11-18** PyPI 下载榜，排除少于 1,000 stars 的包与原 SWE-bench 12 个测试仓库；环境从当时 latest commit 构建。它没有自然 issue 的统一年度覆盖，不能用“真实 PR 年份”描述全部任务。[论文 §2.1、附录 A.2](https://arxiv.org/html/2504.21798)
- **[判断]** 必须固定 HF revision 后重新计数，不能同时引用 50,137、52k、59,136 而不说明版本。时间覆盖应写“仓库选择快照/发布版本”，而不是虚构 issue 时间窗。

### 环境、测试、依赖与凭证

- **[事实]** 先在仓库环境内运行测试，人工核验安装说明，只要求 **>80%** 既有测试通过；再应用候选 bug patch，仅保留能弄坏至少一个原本通过测试的候选，测试运行超过两分钟则丢弃。[论文 §2.1](https://arxiv.org/html/2504.21798)
- **[事实]** 同仓库任务共享一个 Docker 环境，论文环境总量约 **295 GB**；PR Mirror 为兼容安装环境，明确不检出 PR 的 base commit。当前 HF schema 有 patch、F2P/P2P、image_name 等，但没有 base_commit 或 test_patch。[论文 §2.1、§2.2](https://arxiv.org/html/2504.21798)、[HF 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-smith)
- **[事实]** 创建环境需要 Docker，官方只测试 Ubuntu 22.04.4 LTS，不计划支持 Windows/macOS。[官方主 README](https://github.com/SWE-bench/SWE-smith#%EF%B8%8F-build-environments)
- **[判断]** 共享环境降低成本，但也意味着仓库级串扰、非逐例 base commit 和环境差异要显式管理；“有 executable environment”不表示每条都是独立、全新、离线、100% 测试通过的容器。

### 污染、许可与成本

- **[事实]** 官方定位是 **training** 工具与训练数据，并排除了原 SWE-bench 12 repos。[官方主 README](https://github.com/SWE-bench/SWE-smith)、[论文 §2.1](https://arxiv.org/html/2504.21798)
- **[判断]** 上游公开代码和 PR 仍可能进入模型预训练，合成 bug/新 issue 文本不等于证明无污染。
- **[事实]** 代码与 HF 数据卡声明 MIT；论文另列各上游仓库许可证（截至 2025-04-08），包含 permissive 与 protective licenses，并说明其研究使用方式。[代码 LICENSE](https://github.com/SWE-bench/SWE-smith/blob/main/LICENSE)、[HF 数据卡](https://huggingface.co/datasets/SWE-bench/SWE-smith)、[论文附录 A.2](https://arxiv.org/html/2504.21798)
- **[判断]** 重分发任务或环境时仍需保留上游许可；不能把合成修改和 MIT 数据卡视为对原代码的统一再授权。
- **[事实]** 论文报告创建数据集约 **$1,360**：bug 生成 $1,000、自动安装 $160、为 10k bugs 生成 issue $200；约 20 小时作者人工，环境约 295 GB。这是构建成本，不是评估 50k 题的成本。[论文 §2.1–2.2](https://arxiv.org/html/2504.21798)
- **[判断]** 适合训练、课程学习和受控 bug 压力生成，不适合本次最小真实 issue A/B 的开发/保留组。若另做合成压力实验，必须与真实 issue 结果分表，并按 repo 去重，防止同仓库开发/保留泄漏。

## 3. 本次 A/B 的强制筛选规则

以下是**[判断] 建议的准入门槛**；“数据集官方已验证”只能减少工作，不能替代本实验固定版本后的检查。

### 3.1 版本与可比性

1. 记录 benchmark 名、config、HF/git **不可变 revision**、实例 ID 列表及 SHA-256；Pro 明确 default=v2 或 hard，不得混入 v1。
2. 拉取后记录实际 **image digest**，不只记录 :latest 或实例 tag；同时固定 harness、依赖锁、模型版本、系统提示、工具 schema、解码种子/温度、token/turn/time 上限。
3. 两臂跑**同一实例 ID**，其他条件只改变 stable-ptc-eval preset 与普通 PTC；按 repo、语言、日期、难度、修改文件数及预期工具调用强度分层，配对报告，而非把不同基准的分数直接相减。
4. 预先登记开发、保留、压力组。开发组可调 prompt/preset；保留组最终运行，不根据结果回头筛题；HARD-51 只作压力分析。

### 3.2 可执行性与 oracle 有效性

1. 元数据必须有可恢复代码状态、非空 F2P、明确测试命令与 gold/empty 检查；SWE-smith 不能因 schema 相似就跳过 base 状态检查。
2. 在固定基础设施上先跑小规模门禁：**gold patch 通过、empty patch 失败、测试补丁只在 verifier 阶段应用、预测 diff 在 pristine container 重放**。重复运行以识别 flaky；基础设施重试与模型失败分开记账。
3. 检查 F2P 确实由 gold 从失败变通过、P2P 不回归；不要把“有 test_patch 字段”当作测试一定有效。Pro V2 的官方 642/642 双向门禁可复用其证据，但仍需验证本地拉取/运行一致性。
4. 问题描述必须自包含。若必要信息只在外部 URL、图片、私有 issue 或未来 commit 中，主 A/B 排除；若要测联网/多模态，应另建压力组，不能改变主组工具能力。
5. Rebench V2 可先用质量标签排除 B3（外部必要信息）、B4（歧义）等，但标签只是初筛，不能替代实际执行与人工抽查。

### 3.3 隔离、依赖与凭证

1. 镜像应可匿名拉取，运行不要求私有 registry、云账号、内部包源、SSH key 或外部数据库；模型 API endpoint 是唯一明示的网络例外。
2. agent rollout 禁止 WebSearch/WebFetch 与查询上游未来历史；清理 fixing commit、stray refs、stash、hooks 和 oracle 文件。verifier 在另一干净环境执行。
3. 对 agent 和 verifier 分别做断网测试。若 verifier 必须联网（例如 Pro V2 明示的少数 Go modules），选择其一：预先镜像/vendoring 后再断网复验，或从主 A/B 排除并记录；不得悄悄放行。
4. 私有依赖、匿名拉取失败、外部服务、非确定性测试、超时环境都进入排除清单及原因统计；不要为追求题目数量而修改测试使其“通过”。

### 3.4 污染与泄漏

1. 至少按 **instance ID + upstream repo + base commit + gold/test patch 相似性** 对开发、保留、压力、训练语料、prompt 示例和已有轨迹去重；强保留组优先 repo-level disjoint。
2. Rebench V2 必须执行其官方警告的其他 benchmark overlap 检查；不能只依赖“排除原 SWE-bench repos”。
3. 记录模型训练截止日（若供应商未披露则记 unknown）。只有题目和答案晚于截止日、rollout 又无法检索答案时，才作较强的时间外声明。
4. “实验保留”“公开但低污染风险”“时间外”分开写。Verified/Live Lite/Pro HARD 都不自动满足第三者。

### 3.5 许可与重分发

1. 为每个实例保留数据集 license、上游 repo/license、commit、notice 和来源 URL；公开轨迹时不要意外发布 gold/test patch、私有 commercial 内容或凭证。
2. 数据/代码聚合许可与镜像内上游软件许可分别审核；Pro copyleft、Rebench CC BY、其余 MIT 声明都不能替代上游义务。
3. 若只是内部跑分，也保存许可清单；若公开镜像、任务包或派生数据，先完成逐仓库重分发审查。

### 3.6 成本与报告

1. 预算分为模型 token/API、镜像下载与存储、CPU/运行时长、云服务四部分；不要把 Rebench/Smith 的**构建成本**当本次**运行成本**。
2. 两臂使用相同预算和超时；报告每臂实际任务数、无效/基础设施失败数、token、工具调用、wall-clock 与 resolve rate。保留组和压力组不与开发组混成一个总分。
3. 预算不足时，在冻结集合内做**预注册分层抽样**并给出配对不确定性；不要根据中途 A/B 胜负删题，也不要用 HARD-51 的结果外推全量 642 或其他基准。

## 4. 最终适配判断汇总

| 基准 | 开发组 | 实验保留组 | 压力测试 | 本次最小子集结论（均为[判断]） |
|---|---|---|---|---|
| SWE-bench Verified | **适合** | 不宜声称无污染 | 可作一般难度基线 | **采用 500 作开发组** |
| SWE-bench Lite | 可冒烟 | 与 Verified 不独立 | 较自包含，压力有限 | 不进主 A/B；可选 23 dev 冒烟 |
| SWE-bench-Live | 不宜边更新边开发 | **适合冻结批次**；时间外需另证 | 新 repo/新 issue 压力 | **采用冻结 lite 300；或截止日后固定新批次** |
| SWE-rebench V2 | 大规模训练更合适 | 未去重前不适合 | 多语言/长尾盘很强，但成本高 | 不进最小 A/B |
| SWE-bench Pro V2 | 公开集可用于开发但成本高 | public 不宜称无污染；private 需访问权 | **HARD-51 适合** | **采用 HARD-51，仅压力** |
| SWE-smith | 训练/合成数据更合适 | 不建议 | 合成 bug 专项可另做 | 不进最小 A/B |

**[判断] 最终建议一句话：**在同一批实例上做严格配对，使用 **Verified 500 开发 + Live 冻结 300 保留 + Pro V2 HARD-51 压力**；把固定 revision/digest、gold/empty、自包含、无凭证、agent/verifier 网络隔离和跨集合去重作为逐实例准入条件，而不要给任何候选数据集整体贴上“固定 commit、有测试、可隔离、无私有依赖”的免检标签。
