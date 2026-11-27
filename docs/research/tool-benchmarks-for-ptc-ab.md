# 面向 stable-ptc-eval 真实模型 A/B 的工具基准调研

- 调研日期：2026-11-27（Asia/Shanghai）
- 范围：BFCL、ToolBench/ToolLLM、MCP-Universe、Terminal-Bench 2.0，以及 ThakiCloud 2026-08 deferred MCP tool-schema loading 报告和其 Hugging Face artifact。
- 本次只做资料与本地契约核验；**没有修改实现、没有运行真实模型、没有下载大型数据集，也没有把第三方博客或镜像当作独立验证**。
- 标记约定：**事实**指可由所引一手材料直接支持的内容；**判断**指面向本仓库的适配建议或对证据强度的评价；**待验证**指当前 artifact 不能支持、需要后续实验回答的问题。官方博客只用于说明项目方自己的方法，不用于证明其效果获得独立复现。

## 1. 结论先行

1. **判断：首轮最小组合应是“DSH 专属微基准 + BFCL 固定子集 + Terminal-Bench 2.0 小型容器子集”，而不是四个外部基准全跑。** DSH 专属任务直接测 Search/Describe、冷启动、SchemaHash、权限和缓存；BFCL 补参数合法率、负例与多轮；Terminal-Bench 2.0 补真实终端任务的最终通过率。MCP-Universe 留到有专用测试账号和写环境后的第二阶段；ToolBench 首轮只考虑复用检索标注，不引入旧真实 API 和 LLM 评审。
2. **事实：四个外部基准都不直接评测本插件的“会话稳定渐进披露”。** BFCL 通常把候选函数提供给模型；ToolBench 评测另一套 API retriever/agent；MCP-Universe 让 agent 使用真实 MCP server；Terminal-Bench 2.0 主要让 agent 在容器终端完成任务。因此，任何外部总分变化都不能单独归因于 DSH 的 progressive disclosure。[B1][T1][M1][TB1]
3. **事实：ThakiCloud 的核心算术和表格有其 artifact 支撑，但外部效度弱于标题表述。** 26 个真实名称/描述、扩展到 61/150/300 的合成目录、aligned Recall@1=100%、unaligned Recall@1=7.7%、Recall@5=11.5%、300 工具时 91.4% 的估算 token 节省，都能在所公开的脚本和结果 JSON 中找到。[R1][R2][R3]
4. **判断：91.4% 不是“真实模型输入 token 已实测节省 91.4%”，7.7% 也不是生产环境的普遍失败率。** 脚本用字符数估算 token，并未使用真实模型 tokenizer、完整真实 Schema 或端到端 agent；unaligned 查询是作者手工构造的，BM25 零分并列又受目录插入顺序影响。它适合作为设计 DSH 对照任务的警示和方法原型，不适合作为放量阈值或因果证据。[R2][R4]
5. **判断：A/B 必须分层报告，不能压成一个“工具调用准确率”。** 最终任务通过率是主结果；Search Recall@1/@5、首次目标工具命中率、Describe 成功率、参数合法率和正确拒答率是机制指标；缓存/非缓存 token、实际费用、发现轮次和 p50/p95 延迟是成本指标。AST 合法不等于任务语义正确，Recall 高也不等于模型会主动搜索。

## 2. 本地 DSH 契约与适配边界

### 2.1 已核实的本地事实

- 插件只安装在独立的 **stable-ptc-eval** preset；普通 **ptc** 不安装插件，子 Agent 默认排除，适合作为对照臂。[D1]
- 评估臂线上直接工具仍只有 **run_code**；初始 TypeScript SDK 包含 **search_tools**、**describe_tools**、Eager Tools 和会话创建时选定的 Shell。其他工具不预载声明，但实时 PTC Binding 仍可执行；披露不授予权限。[D1]
- Search 查询实时 Tool Catalog，默认有界分页；Describe 按准确名称返回完整描述、输入/输出 Schema、SDK 片段和 SchemaHash。目录变化会使旧游标失效，Schema 变化可触发 **TOOL_SCHEMA_CHANGED**。[D1][D4]
- 当前离线检索指标是固定标注集上的 macro Recall@5，生产 Search 与离线评测共用词法排序；它不是语义检索器，也不是真实模型任务通过率。[D1][D3]
- ADR 已列出成本、发现轮次、Recall、首次命中、参数合法率、任务通过率和延迟等待测指标；其中 Recall≥97%、通过率回退≤2 个百分点、成本下降≥15% 是**设计门槛，不是已有实验结果**。[D2]

### 2.2 对外部基准的统一适配原则（判断）

- 固定同一模型/端点快照、解码参数、系统提示除 tools:sdk 外的内容、任务、Tool Catalog、权限、凭证、容器镜像和随机种子；同一任务成对跑普通 PTC 与 stable PTC。
- 不应把“BFCL 官方 handler 跑一遍”和“DSH 插件跑一遍”直接比较：两者的提示词、执行循环和 scorer 输入可能不同。需要薄适配器把同一函数文档映射为 DSH ToolDefinition，并把官方状态/响应检查器或等价断言接到同一任务初始状态。
- 普通 PTC 臂必须预载同一批完整 Schema；stable 臂只改变披露方式。若同时更换 retriever、工具实现、ReAct 策略或模型，无法识别渐进披露的净效应。
- Search 指标要把**原始排序结果**与 zeroMatch=catalog 的 fallback 分开报告；否则“返回整个目录”可能虚增 Recall，掩盖词法检索未命中。
- 参数合法率应定义为“运行时 Schema 校验接受的调用 / 尝试调用”，另报参数语义正确率与任务通过率；合法但订错机票仍然是任务失败。

## 3. 横向对照

| 项目 | 任务与规模（事实） | 执行、负例、多轮（事实） | 环境/许可（事实） | 对 DSH 的判断 |
|---|---|---|---|---|
| **BFCL V4** | V4 发布方法页列出 5,088 个计分条目：Agentic 665、Multi-Turn 800、Live 1,351、Non-Live 1,150、Hallucination 1,122；另有 5,218 个不计分条目（含 5,200 format sensitivity）。[B2] | **混合式**：大量单轮 AST；多轮在模拟 API 后端实际执行并检查 state+response；web search 走实时网络；memory 有可执行后端。1,122 个 irrelevance 负例；多轮含 missing function/parameter。[B1][B2] | Python 3.10；模型 API key；当前 README 的 web_search 类别使用 SerpAPI key。仓库与官方 HF 数据卡标 Apache-2.0。[B4][B5][B6] | **中成本，首轮选用。** AST/负例做微基准，多轮子集做任务通过率；不拿总分当 Search/Recall。 |
| **ToolBench / ToolLLM** | 3,451 tools、16,464 REST APIs、126,486 条解路径、469,585 次真实 API 调用，平均 4 步；G1 单工具、G2 同类多工具、G3 同 collection 多工具；当前 README 称每个测试集抽 200 条。[T1][T2] | 构造数据时真实执行 REST API，多轮工具调用；有 “Finish by Giving Up” 和 retriever 对比学习负例，但不是系统的无工具拒答套件。ToolEval 的 pass/win rate 由 ChatGPT 评审。[T2] | RapidAPI key/订阅或项目后端、OpenAI 评审 key；真实 API 随时间变化。项目 LICENSE 为 Apache-2.0，README 同时声明研究/教育用途意图；第三方 API 条款不因项目许可消失。[T1][T3] | **高成本，不作首轮主任务。** 可把查询—相关 API 标签离线映射为检索微基准；真实执行与 LLM judge 会引入额外噪声。 |
| **MCP-Universe** | 231 tasks、6 domains、11 个真实 MCP servers，覆盖导航、仓库、金融、3D、浏览器、搜索。[M1][M2] | 真实 MCP server 上长程、多步执行；format/static/dynamic execution-based evaluators，动态答案取实时 ground truth。未见独立的系统无工具负例或用户澄清多轮设计说明。[M1][M3] | Docker；按域需要 SerpAPI、Google Maps、GitHub、Notion 等凭证及 Blender；GitHub 官方建议专用测试账号。LICENSE.txt 为 Apache-2.0。[M3][M4] | **很高成本，第二阶段外部效度。** 适合真实 MCP 主任务通过率，不适合低成本首轮；只有刻意隐藏目录后才测 DSH Search。 |
| **Terminal-Bench 2.0** | 官方任务页为 89 个容器任务；内容含科学计算、异步调试、安全漏洞、数据处理、系统配置等。[TB1][TB2] | agent 在容器中真实执行，任务测试/pytest 等 verifier 判最终产物；有 oracle solution。不是目录检索套件，也不是标准用户多轮套件；个别任务会测无效输入。[TB2][TB4] | Harbor + Docker/云容器，模型 key；任务可允许联网，资源/超时按 task.toml。仓库 Apache-2.0。[TB2][TB4][TB5] | **中高成本，首轮小子集。** 适合最终任务回归与 Shell/成本测量；Search/Recall 必须由额外 DSH 任务覆盖。 |
| **ThakiCloud deferred artifact** | 26 个真实工具的名称/一行描述，程序生成 filler 扩至 26/61/150/300；每个规模仍只有 26 个真实目标、每目标两种手写查询。[R1][R2] | 确定性 BM25 模拟，不执行真实模型或工具；无多轮任务。CC BY 4.0。[R1][R2] | 只需 CPU 即可复算；artifact 内嵌 Python，而非真实 harness 快照。[R2] | **低成本方法参考，不是外部主任务基准。** 用真实竞争目录、随机并列和 DSH 排序重新实现。 |

> 版本提醒：BFCL 官方 HF 卡仍展示早期 V2/V3 口径，V4 方法页与当前代码又增加了类别和搜索后端；Terminal-Bench 当前已出现更高版本。本笔记的规模分别绑定到 **V4 发布方法页**和 **Terminal-Bench 2.0 独立仓库**，运行时必须 pin 数据与 scorer revision，不能混用 main/latest。

## 4. 逐项证据与适配分析

### 4.1 BFCL：最适合拆成参数、负例和多轮三类微基准

**事实**

- 单轮 simple/multiple/parallel/parallel_multiple 主要用 AST 比较函数名和参数，不能统称“真实 API 执行”；V1 的可执行类别只是其中一部分。[B5]
- V3 的计分多轮为 base、missing function、missing parameter、long context 各 200，共 800。每条多轮数据初始化模拟后端，模型可连续调用函数，逐轮同时通过 state-based 与 response-based 检查才算正确。[B1]
- missing function 先扣留必要函数、后续再提供；missing parameter 需要澄清。V2/V4 的 irrelevance 则要求不调用无关函数。两者分别适合测“能力缺失处理”和“无工具负例”，不应混为一个指标。[B1][B2]
- V4 Agentic 为 web search 200（100 题在 snippet/no-snippet 两种条件）和 memory 465（三种后端各 155）。原始 web 方法页使用 DuckDuckGo；当前 README 已改为 SerpAPI，说明运行时必须记录实现版本。[B2][B4]

**判断**

- 首轮选取 **simple_python/multiple/parallel_multiple** 做函数选择与参数微基准，**irrelevance/live_irrelevance** 做正确拒答，**multi_turn_base/miss_func/miss_param** 做执行式主任务。无需先跑 web/memory/format sensitivity，也无需采用 V4 的加权总分。
- BFCL 的候选函数列表不是 26—300 工具的 deferred catalog，因此官方结果不能回答 DSH Search Recall。可把候选函数转成同一 Catalog，再额外设计“目标工具在初始 SDK / 仅在隐藏目录”两个任务因子。
- 多轮模拟后端与 DSH TypeScript PTC 不同，适配工作主要在函数文档到 JSON Schema、初始状态和 scorer，而不是重写任务语义。工作量**判断为中**；比 MCP-Universe 的真实账号体系可控。

### 4.2 ToolBench/ToolLLM：检索标签有价值，旧 API 主任务不适合最小 A/B

**事实**

- ToolBench 的优势是规模和查询—API 监督：官方论文报告 retriever 的 NDCG@1/@5，并用未相关 API 作为对比学习负例；这与 Search/Recall 微基准形式相近。[T2]
- 数据构造保留的是 DFSDT 找到的有效解路径，Instruction 与答案均由 ChatGPT 自动生成并过滤。它含多步 API 调用，但不等价于带用户澄清的多轮对话。[T2]
- ToolEval pass rate 与 win rate 依赖 ChatGPT 评审；论文报告其与人工标注的一致率，而不是确定性状态断言。真实 API 的可变响应又是作者明确需要处理的问题。[T2]
- 官方 README 的完整数据发布入口是 Google Drive/清华云，不是官方 HF 数据集；HF 上第三方 ToolBench 镜像未被本笔记用作证据。[T1]

**判断**

- 可把固定 revision 的 instruction/relevant-API 标签转换成 DSH 离线检索集，报告 Recall@k/NDCG；无需执行 469k 调用的轨迹，也无需模拟 ToolLLaMA 的 DFSDT。
- REST 文档到 ToolDefinition 需要处理 tool/API 两级命名、HTTP body/query/path 参数、命名冲突和输出 Schema 缺失。若为了执行再录制 mock response，测到的将是录制保真度加 agent，不再是“真实 API”。
- 因 API 时效、凭证、LLM judge 和协议转换四重噪声，**不建议把 ToolBench pass/win rate 作为 stable-vs-ordinary PTC 的首轮主结果**。

### 4.3 MCP-Universe：真实 MCP 外部效度最好，但准备成本最高

**事实**

- 它直接使用真实 MCP servers 和实时数据源，强调 long-horizon、大型陌生工具空间；静态、动态与格式 evaluator 都是执行框架的一部分，而非单纯 AST。[M1]
- 真实 GitHub/Notion 操作可能修改外部状态，项目方明确建议专用 GitHub 账号、最小权限和隔离环境；3D 任务还需要指定 Blender 版本和路径。[M3]

**判断**

- 与 DSH 的 MCP/Tool Catalog 映射最自然，但普通 PTC 与 stable PTC 必须接同一 server 版本和账号初始状态。动态 ground truth 应同时快照，否则两臂可能在不同数据上评分。
- 它更适合第二阶段验证“在真实 MCP 上，渐进披露是否保持任务通过率”，不适合测纯参数合法率；真实服务失败、配额和外部状态会显著增加配对实验成本。
- 若只做一个域，优先只读或易重置的 web search/location；repository management 必须使用专用账号和可重置仓库。该取舍是工程判断，不是官方排名结论。

### 4.4 Terminal-Bench 2.0：最终任务回归，不是工具发现基准

**事实**

- 2.0 官方独立仓库的 README 给出 Harbor 本地 Docker 运行方式和 oracle；公告说明任务经过人工与 LM-assisted 验证，并特别提到旧任务受外部反爬变化影响的教训。[TB2][TB3]
- 任务 manifest 可精确指定 Docker image、CPU/内存/存储、超时与 allow_internet；示例任务的 pytest 检查最终文件、统计性质、错误处理和输入校验。[TB4]

**判断**

- 它可发现“省了 Schema token 却完不成真实工作”的回退，且无需把每个终端命令包装成 MCP 工具；DSH 的 bash 工具可直接执行任务。
- 因 Shell 可在两臂都 Eager，Terminal-Bench 默认几乎不触发 Search/Describe。应把它作为**端到端安全网**，而非证明 progressive discovery 有效的唯一证据。
- 最小筛选可选 8—12 个 CPU-only、无专用外部账号、镜像可固定且 oracle 稳定的任务；该小子集只做回归信号，不能据此宣称与完整 89 任务排行榜可比。

## 5. ThakiCloud deferred 研究：artifact 审计

### 5.1 artifact 实际包含什么

官方 HF revision **4c98b39c25944076a5ca098cbccc3c36ba461ebb** 包含报告、LaTeX、experiments/plan.json、experiments/results.json 和图表。plan.json.custom.script 内嵌完整 Python：26 个名称/描述、52 条手写任务、filler 生成、BM25、token 估算与结果写出均在其中；结果 JSON 给出四个规模、三个 k 和每工具 base-corpus 排名。[R1][R2][R3]

**事实核对表**

| 说法 | artifact 是否支撑 | 精确口径 |
|---|---|---|
| 26 工具；61/150/300 | **支撑** | 仅 26 个真实名称/描述；其余为程序生成、刻意词汇不相交的 filler。每个规模都是同样 26 个目标的 aligned/unaligned 查询，不是 300 个真实任务。[R2] |
| aligned 100% | **支撑脚本结果** | 四个规模 Recall@1/@3/@5 都为 26/26。[R3] |
| 词法不对齐“召回近 0” | **数值支撑，但应写精确值** | Recall@1=2/26=7.69%，@3 相同，@5=3/26=11.54%；不是严格 0，也不是模型端到端失败率。[R3] |
| 规模增大 recall 不变 | **支撑该构造下的输出** | @5 在四个规模均为 11.54%；不能外推到真实竞争目录。[R2][R3] |
| 91.4% token 节省 | **算术支撑，实测含义不支撑** | k=1、300 工具、aligned：1 - 2127.1923/24800 = 91.4226%。24800 与 2127 都来自脚本的字符/token 模型，不是 provider tokenizer 计数。[R2][R3] |
| 非对齐每次成功发现成本更高 | **按作者定义算术支撑** | 例如 300 工具、k=1：2059.8077 / (2/26) ≈ 26777.5 > 24800。这是总体平均成本除以恢复比例，不是一次 retry 的成本。[R3][R4] |
| codegraph 排名 21—26 | **支撑 base 26 目录结果** | 结果 JSON 记录这七项的排名；不能据此推断所有检索器或真实模型都如此。[R3] |

### 5.2 实验设计和外部效度限制（判断）

1. **没有模型生成查询，也没有工具执行。** 作者预先写好“模型可能会问”的两种文本，再把这些文本直接分词给 BM25；因此它测的是手写查询—目录匹配，不是 unknown-unknown 在真实 agent 中的发生率，更不是任务通过率。[R2]
2. **token 不是实测 token。** est_tokens(text)=max(1,len(text)//4)，full_schema_tokens(desc)=est_tokens(desc)*4+15；artifact 未提供 26 个完整生产 JSON Schema。91.4% 可称为“脚本估算输入单位减少”，不应直接转成账单或 DSH token 预期。[R2]
3. **零分并列影响精确召回与排名。** 排序只按分数降序，Python 稳定排序保留插入顺序。部分 unaligned 目标与查询重叠为 0；结果中 CronCreate 在 overlap=0 时仍列 rank 1，而 codegraph 位于真实目录尾部。未做目录 shuffle/tie-break 消融，7.7%、11.5% 和“codegraph 垫底”的精确数值因此对构造顺序敏感。[R2][R3]
4. **规模操纵刻意消除竞争。** filler 与查询、目标都词汇不相交，分数接近 0，无法模拟真实 MCP 中 search/get/list/status/run 等通用词竞争。平坦 Recall 是此设计的合理结果，不能“证明”大规模真实目录不会稀释。[R2]
5. **只测一个 BM25 配置。** “regardless of ranker quality” 超出证据；dense/hybrid、查询扩展、描述重写、同义词、Eager 常用工具都可能改变结果。DSH 自己的词法排序也需单独测，不能套用 BM25 数字。[R2]
6. **Eager Recall=1 是定义，不是模型选择准确率。** 全 Schema 在上下文中并不保证模型选中正确工具；两臂的真实首次命中率仍未测。[R4]
7. **单一 harness、作者构造任务、无独立标注/复现。** “生产 26 工具”缺少可核验的 harness commit/export；final-review.json 的 approve 是同一发布流水线内的检查，不是独立同行评审或外部复现。[R2][R6]
8. **“总冷启动失败的下界”不能解释为统计下界。** 不搜索确实未计入，但手写 unaligned 任务的难度分布没有生产代表性，可能高估也可能低估真实失败；因此只能说它隔离了一个额外失败机制，不能推出生产失败率至少 88.5%。
9. **不声称“只有这一篇”。** 本次是定向核验而非系统综述，没有穷尽所有 deferred/tool retrieval 文献，也不接受报告自述的“既有文献从未测量”为独立事实。

**对 DSH 可迁移的部分（判断）**：保留 aligned/paraphrased-unaligned 对照、目录规模、Recall@k 与发现成本四个因子；换成真实 DSH Catalog 和完整 Schema，加入真实竞争 filler、目录随机排列、不同 k、实际 tokenizer/provider usage、模型是否主动 Search，以及最终任务 verifier。

## 6. 最小推荐组合与后续顺序

### 首轮（必须有）

| 层 | 最小内容 | 回答的问题 | 不适合回答 |
|---|---|---|---|
| **A. DSH 离线检索微基准** | 固定真实 Catalog；aligned/unaligned；26/61/150/300；真实近义竞争 filler；Recall@1/@5、fallback、实际 token | 插件词法 Search 是否找得到，成本是否随目录增长 | 模型是否主动搜索、最终任务是否成功 |
| **B. BFCL 固定子集** | AST simple/multiple/parallel_multiple + irrelevance + multi_turn base/miss_func/miss_param；pin revision 和 scorer | 参数合法/语义、负例、多轮状态执行在两种披露下是否回退 | DSH 大目录 Recall、真实终端通用性 |
| **C. DSH 专属端到端任务** | 下文 48 个任务规格，普通/stable 成对、同模型同目录同权限 | 主动发现、Describe、参数、权限、最终通过率、成本的净效应 | 对全部 MCP 生态的外部效度 |
| **D. Terminal-Bench 2.0 小型子集** | 8—12 个固定 CPU-only 任务，先验证 oracle；两臂相同容器 | 真实终端工作的端到端安全网 | Search/Recall、完整 89 任务排名 |

MCP-Universe 和 ToolBench 不进入首轮最小集合。第二阶段再用 MCP-Universe 的 1—2 个可重置域做真实 MCP 外部验证；ToolBench 的固定检索标签可作为 A 层的补充语料，但不与 DSH 自有查询混算一个平均分。

**判断：不要给上述层合成加权总分。** 每层保留独立通过率和配对差值；真实模型阶段再对同一任务的 ordinary/stable 结果做 paired difference 与置信区间。小样本 Terminal 子集只作预警，不把“回退≤2pp”等设计门槛当作统计上已证明的等价性。

## 7. 应自建的 DSH 专属任务

### 7.1 任务族

| 任务族 | 建议规格与对照 | 关键负例/边界 | 主要指标 |
|---|---|---|---|
| **冷启动隐藏工具发现** | 同一任务分 aligned、语义同义但词法不对齐、多工具三版；目标只在隐藏 Catalog，提示中不泄露名称 | 目标描述含品牌/内部代号；存在近义竞争工具；目录 shuffle；k=1/3/5 | 主动 Search 率、Recall@1/@5、首次目标命中、Describe 率、任务通过率、额外轮次 |
| **无工具与澄清负例** | 无任何匹配能力、缺必要参数、只有相似但错误工具、需要用户补充后才可执行 | 不应调用时调用；应澄清时乱猜；有效请求被过度拒答 | 正确拒答率、正确澄清率、过度拒答率、幻觉工具名率 |
| **Schema/参数合法率** | 嵌套 object/array、enum、required/optional/default、特殊字符工具名、输出 Schema、批量与并行调用 | 缺 required、错误类型、未知字段、凭空默认值、猜测工具名或 Schema | Schema 接受率、参数语义正确率、Describe 准确率、运行时错误分类 |
| **多轮状态与错误恢复** | 工具输出成为下一步输入；用户后续补充参数/函数；工具返回可恢复错误；顺序与并行混合 | 前一轮错误、长输出、状态变化、重复写入 | 每轮 state+response、最终通过率、恢复率、重复副作用 |
| **动态 Catalog 与 Schema 生命周期** | 会话后注册/删除/restrict；分页中目录变化；Describe 后 Schema 变化；未 Describe 直接按准确名调用 | 旧 cursor、旧 SchemaHash、已删除工具、权限收紧 | Surface 字节不变、正确错误码、重试成功、无越权、任务通过率 |
| **权限、Approval 与 Shell** | 隐藏只读/写工具、需要 Approval、bash/pwsh/none；普通/stable 同策略 | 披露被误当授权、跨平台命令错误、隐藏写操作绕过审批 | 越权次数必须为 0、审批一致率、Shell 任务通过率、失败类型 |
| **resume/fork/Compaction** | Search/Describe 后恢复和 fork；Compaction 后继续任务；普通装配不推进 Epoch | SchemaHash 历史丢失、Surface 重算漂移、重复披露 | SurfaceHash、缓存连续性、恢复后任务通过率、token/费用 |
| **普通 PTC 与子 Agent 隔离** | 同任务普通 ptc、stable、子 Agent 三臂；插件安装/rollback | 对照臂被插件提示或状态污染 | 普通臂逐字节一致、子 Agent 不受影响、rollback 后新会话恢复 |

Describe 不是强制前置步骤；按准确名称直接调用隐藏工具是合法路径，不能把 Describe 率解释为“越高越好”。动态 Catalog、Surface、隔离等已有工程契约测试的维度，不应被真实模型任务通过率替代；它们继续作为确定性放行门槛。[D1]

### 7.2 一个可执行的首轮任务配额（判断）

先建 **48 个任务规格**：8 个 Eager 直接任务、12 个隐藏单工具（aligned/unaligned 各半）、8 个隐藏多工具链、8 个无工具/缺参/权限负例、6 个多轮状态任务、6 个 Schema/动态目录任务。每任务普通/stable 两臂，未来真实模型阶段至少 3 次重复，即 288 次运行（48×2×3）；这是后续规划，**本次未执行**。另建约 60 个查询主题，每主题两种措辞、四个目录规模，用于无模型的离线 Search 微基准。

记录表中除 scorer 结果外，还应保留 task id、catalog/schema hash、模型与端点版本、prompt/surface hash、工具版本、容器 digest、随机种子、是否 fallback、Search/Describe 次数、首次命中步数、参数错误类型、缓存与非缓存 token、实际费用和延迟。生产 telemetry 不记录查询/参数/结果正文，因此受控评测集需要单独、明确授权地保存必要 trace，不能指望现有 metadata-only JSONL 完成失败归因。[D1]

## 8. 风险与待验证清单

- **待验证：** DSH 当前词法 Search 在真实不对齐查询、近义竞争和目录 shuffle 下的 Recall；ThakiCloud 数字不能代答。
- **待验证：** 模型在不知道工具存在时是否主动 Search，以及 Eager 高频工具能否避免不必要发现轮次。
- **待验证：** Describe 完整输出对大 Schema 的上下文/Provider 限制；当前插件不主动截断，错误不能被静默忽略。[D1]
- **待验证：** 普通 PTC 与 stable PTC 在真实模型上的任务通过率、成本和延迟净差；现有 SDK 工程验收不证明这些结果。[D1]
- **版本风险：** BFCL 的 HF 卡、方法博客和当前代码口径并不完全一致；ToolBench API 与 MCP-Universe 动态答案随时间变化；Terminal-Bench latest 已不是 2.0。运行清单必须写 commit/revision，而不是只写项目名。
- **许可边界：** Apache-2.0/CC BY 只覆盖对应项目或 artifact；真实 RapidAPI、SerpAPI、Google Maps、GitHub、Notion 等服务和数据仍受各自条款、配额与隐私限制。使用专用测试账号，不复制真实用户数据到评测 trace。
- **证据边界：** 本笔记没有证明某研究“只有一篇”，也没有把项目方自报准确率、token 节省或 leaderboard 名次当作独立复现。

## 9. 一手来源与 revision

本地契约：[D1] 本仓库 README；[D2] 本仓库 ADR 0001；[D3] 本仓库 src/search-recall.ts；[D4] 本仓库 src/host.ts。

- **BFCL**：[B1] 官方 V3 多轮方法、规模、模拟后端与 scorer；[B2] 官方 V4 web 方法与计分构成；[B3] 官方 V4 memory 方法；[B4] 官方仓库 README/TEST_CATEGORIES（核验 revision 6ea57973）；[B5] 官方 HF 数据卡；[B6] 官方 Apache-2.0。
- **ToolBench/ToolLLM**：[T1] 官方 README（核验 revision d56fdd89）；[T2] 官方论文；[T3] 官方 Apache-2.0。
- **MCP-Universe**：[M1] 官方论文摘要；[M2] 官方项目站（231 tasks）；[M3] 官方 README（核验 revision 0df6c427）；[M4] 官方 Apache-2.0。
- **Terminal-Bench 2.0**：[TB1] 官方任务页（89 tasks）；[TB2] 官方 2.0 仓库（核验 revision 2fd12b88）；[TB3] 官方公告；[TB4] 官方任务 manifest/verification 示例；[TB5] 官方 Apache-2.0。
- **ThakiCloud deferred**：[R1] 官方 HF 数据卡（CC BY 4.0）；[R2] 官方 experiments/plan.json（内嵌脚本）；[R3] 官方 experiments/results.json；[R4] 官方报告 LaTeX；[R5] ThakiCloud 自有博客（只作其方法陈述）；[R6] 官方 final-review.json（发布流水线自审，不是独立验证）。HF revision 均为 4c98b39c25944076a5ca098cbccc3c36ba461ebb。

[D1]: ../../README.md
[D2]: ../adr/0001-preset-scoped-stable-progressive-tools.md
[D3]: ../../src/search-recall.ts
[D4]: ../../src/host.ts
[B1]: https://gorilla.cs.berkeley.edu/blogs/13_bfcl_v3_multi_turn.html
[B2]: https://gorilla.cs.berkeley.edu/blogs/15_bfcl_v4_web_search.html
[B3]: https://gorilla.cs.berkeley.edu/blogs/16_bfcl_v4_memory.html
[B4]: https://github.com/ShishirPatil/gorilla/tree/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/berkeley-function-call-leaderboard
[B5]: https://huggingface.co/datasets/gorilla-llm/Berkeley-Function-Calling-Leaderboard
[B6]: https://github.com/ShishirPatil/gorilla/blob/6ea57973c7a6097fd7c5915698c54c17c5b1b6c8/LICENSE
[T1]: https://github.com/OpenBMB/ToolBench/tree/d56fdd89faf8c91fa135090b212bb9057ee5cfc2
[T2]: https://arxiv.org/abs/2307.16789
[T3]: https://github.com/OpenBMB/ToolBench/blob/d56fdd89faf8c91fa135090b212bb9057ee5cfc2/LICENSE
[M1]: https://arxiv.org/abs/2508.14704
[M2]: https://mcp-universe.github.io/
[M3]: https://github.com/SalesforceAIResearch/MCP-Universe/tree/0df6c42717f2a618d34f5b271efd05be462b9e4d
[M4]: https://github.com/SalesforceAIResearch/MCP-Universe/blob/0df6c42717f2a618d34f5b271efd05be462b9e4d/LICENSE.txt
[TB1]: https://www.tbench.ai/benchmarks/terminal-bench-2
[TB2]: https://github.com/harbor-framework/terminal-bench-2/tree/2fd12b88aafdd04a52c298e3940bcb189f9766d6
[TB3]: https://www.tbench.ai/news/announcement-2-0
[TB4]: https://github.com/harbor-framework/terminal-bench-2/tree/2fd12b88aafdd04a52c298e3940bcb189f9766d6/adaptive-rejection-sampler
[TB5]: https://github.com/harbor-framework/terminal-bench-2/blob/2fd12b88aafdd04a52c298e3940bcb189f9766d6/LICENSE
[R1]: https://huggingface.co/datasets/thaki-AI/daily-paper-2026-08-03-deferred-tool-schema-discovery-cost/tree/4c98b39c25944076a5ca098cbccc3c36ba461ebb
[R2]: https://huggingface.co/datasets/thaki-AI/daily-paper-2026-08-03-deferred-tool-schema-discovery-cost/blob/4c98b39c25944076a5ca098cbccc3c36ba461ebb/experiments/plan.json
[R3]: https://huggingface.co/datasets/thaki-AI/daily-paper-2026-08-03-deferred-tool-schema-discovery-cost/blob/4c98b39c25944076a5ca098cbccc3c36ba461ebb/experiments/results.json
[R4]: https://huggingface.co/datasets/thaki-AI/daily-paper-2026-08-03-deferred-tool-schema-discovery-cost/blob/4c98b39c25944076a5ca098cbccc3c36ba461ebb/main.tex
[R5]: https://thakicloud.com/tech-blog/ko/research/deferred-tool-schema-discovery-cost/
[R6]: https://huggingface.co/datasets/thaki-AI/daily-paper-2026-08-03-deferred-tool-schema-discovery-cost/blob/4c98b39c25944076a5ca098cbccc3c36ba461ebb/final-review.json
