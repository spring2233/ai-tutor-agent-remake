import { THEME_PALETTES, type ThemePalette } from './planetIdentity';
import type { KnowledgeZone, ZoneSave } from '../components/explore/zones';

export interface PresetPlanetSpec {
  id: string;
  planetName: string;
  fileName: string;
  pages: number;
  themeCategory: 'ai_cs' | 'physics_math';
  themePalette: ThemePalette;
  themeSummary: string;
  epigraph: string;
  zones: KnowledgeZone[];
}

export const PRESET_PLANETS: PresetPlanetSpec[] = [
  {
    id: 'preset-transformer',
    planetName: '「矩心·自注意力界」',
    fileName: 'Attention_Is_All_You_Need_Transformer.pdf',
    pages: 15,
    themeCategory: 'ai_cs',
    themePalette: THEME_PALETTES.ai_cs,
    themeSummary: '摒弃循环与卷积，以多头自注意力矩阵与正弦位置编码重构序列建模的并行宇宙。',
    epigraph: '当每一个词元都能跨越时空直接凝视彼此，序列便坍缩成了可并行点亮的星图。',
    zones: [
      {
        id: 'zone-1',
        zoneTitle: '序列瓶颈与全局直连',
        title: '序列瓶颈与全局直连',
        zoneIntro: '打破 RNN 逐步传递隐状态的串行枷锁，将任意两位置路径缩短为常数 O(1)。',
        summary: '打破 RNN 逐步传递隐状态的串行枷锁，将任意两位置路径缩短为常数 O(1)。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 I：RNN 必须等 t-1 算完才能算 t，既锁死 GPU 并行度，又让远距离信息在传递中衰减；Self-Attention 让任意两个词一步直连（最大路径长度 O(1)），用空间换取了彻底的时间并行。',
        intel: {
          conclusions: [
            'RNN 按顺序一步步传话，句子越长越容易遗忘前文且无法并行训练',
            '自注意力让句中任意两个词直接建立连接，信号传递步数恒为 O(1)',
            '序列较短或中等长度时，自注意力每层计算复杂度更具优势且并行度极高',
          ],
          analogy: '就像从「击鼓传花悄悄话」升级成「圆桌会议全员面对面对视」。',
        },
        calibration: {
          statement: 'Self-Attention 将序列中任意两个位置之间的信号传播最大路径长度降为了常数 O(1)。',
          isSignal: true,
          why: '原文 Table 1 明确对比：Self-Attention 的 Maximum Path Length 为 O(1)，而循环层为 O(n)。',
        },
        circuit: {
          q: '为什么 Transformer 训练吞吐量远高于循环神经网络（RNN）？',
          options: [
            '消除了时间步之间的顺序依赖，整段序列可在矩阵乘法中一次性并行计算',
            '完全删除了所有非线性激活函数',
            '把词向量维度压缩到了 1 维标量',
            '只保留句子首尾两个词参与梯度反传',
          ],
          answer: '消除了时间步之间的顺序依赖，整段序列可在矩阵乘法中一次性并行计算',
          why: '去掉 h_t 对 h_{t-1} 的串行依赖后，所有位置的注意力权重可以通过单次矩阵乘法并行求得。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 序列守望者',
          challengePrompt: '按顺序一个词一个词读才符合人类直觉，凭什么一次性把整句话摊平反而更能抓准长距离因果？',
          keyPoints: [
            '串行传递会导致长距离梯度衰减与信息磨损',
            '全局两两直连把任意两词交互距离缩为一步 O(1)',
            'GPU 矩阵并行一次性算完整个上下文',
          ],
          followUpHint: '如果句子有 500 个词，第 1 个词要影响第 500 个词，在 RNN 和自注意力里分别要走几步？',
          referenceExplanation:
            '顺序递推每多走一步就会损耗一点早期记忆，而且后一步必须苦等前一步算完。自注意力直接让第 1 个词和第 500 个词一步对话，既不丢长程关联，又能让算力瞬间并行铺满整张星图。',
          terms: ['O(1)路径', '矩阵并行', '长程依赖'],
          decoyTerm: '池化步长',
        },
      },
      {
        id: 'zone-2',
        zoneTitle: 'QKV 缩放点积核心',
        title: 'QKV 缩放点积核心',
        zoneIntro: '以 Query 检索 Key 的相似度分布，除以 √d_k 守护梯度活性，加权聚合 Value。',
        summary: '以 Query 检索 Key 的相似度分布，除以 √d_k 守护梯度活性，加权聚合 Value。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 II：Attention(Q,K,V) = softmax(QK^T / √d_k)V。当维度 d_k 增大时，点积方差线性膨胀为 d_k，若不除以 √d_k，Softmax 将坠入极端饱和区导致梯度趋近于零。',
        intel: {
          conclusions: [
            '每个词同时分身出三张卡片：提问卡 Query、标签卡 Key、内容卡 Value',
            '用 Q 与所有 K 做点积算出匹配分，经 Softmax 归一化后按权重提取 V',
            '除以 √d_k 是为了把方差拉回 1，防止高维点积过大把 Softmax 推入梯度死区',
          ],
          analogy: '带着检索词（Q）去匹配书架标签（K），按相关度比例把几本书的正文（V）调和成笔记。',
        },
        calibration: {
          statement: '缩放点积注意力除以 √d_k 主要是为了减少矩阵乘法的浮点运算次数。',
          isSignal: false,
          why: '除以 √d_k 并不会减少矩阵乘法次数，真正目的是在高维 d_k 下防止点积幅值过大导致 Softmax 饱和、梯度消失。',
        },
        circuit: {
          q: '当向量维度 d_k 很大且不除以 √d_k 时，训练会发生什么现象？',
          options: [
            'QK^T 点积方差随 d_k 变大，Softmax 输出趋近 one-hot，梯度极小难以更新',
            'Value 矩阵会自动清零',
            '模型参数量翻倍导致显存溢出',
            '位置编码彻底失效变成随机数',
          ],
          answer: 'QK^T 点积方差随 d_k 变大，Softmax 输出趋近 one-hot，梯度极小难以更新',
          why: '独立零均值单位方差分量的点积方差为 d_k，除以 √d_k 恰好将标准差重新归一化为 1。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 点积仲裁官',
          challengePrompt: '不过就是算个相似度再加权平均罢了，干嘛非要多此一举除以根号 d_k？直接喂给 Softmax 不行吗？',
          keyPoints: [
            'Q 与 K 点积衡量词元间的相关性权重',
            '维度 d_k 变大时点积数值方差成倍放大',
            '除以 √d_k 避免 Softmax 进入梯度接近 0 的平缓饱和区',
          ],
          followUpHint: '当输入 Softmax 的几个数字差距被拉大到几十倍时，它的导数会变成什么样？',
          referenceExplanation:
            'Q 和 K 的点积在维度高时会累加出很大的正负极值，一旦喂进 Softmax 就会变成赢家通吃的 0.9999 和 0.0001，曲线斜率几乎归零，网络就学不动了；除以 √d_k 就像给温度降压，让梯度保持柔和灵敏。',
          terms: ['Query-Key', '√d_k缩放', '梯度饱和'],
          decoyTerm: '动量衰减',
        },
      },
      {
        id: 'zone-3',
        zoneTitle: '多头子空间协同',
        title: '多头子空间协同',
        zoneIntro: '将特征投影至 h 个独立低维子空间并行关注语法、指代与语义，再拼接融合。',
        summary: '将特征投影至 h 个独立低维子空间并行关注语法、指代与语义，再拼接融合。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 III：单头注意力在求平均时会模糊不同维度的关系；Multi-Head 将 d_model 拆分为 h 个 d_k = d_model/h 的投影子空间，在不增加总算力数量级的前提下，同步捕获句法结构、代词指代与语义修饰。',
        intel: {
          conclusions: [
            '单头注意力把所有关注点混成一个平均权重，容易顾此失彼',
            '多头机制用 h 组不同投影矩阵切出多个观察视角，分别盯住语法、指代和语义',
            '每个头维度缩小为 d_model / h，总计算开销与单头全维注意力基本相当',
          ],
          analogy: '如同会诊时请语法专家、逻辑专家、背景专家同时审阅同一份档案，最后汇总成一份立体报告。',
        },
        calibration: {
          statement: '8 头自注意力的总计算量大约是同等 d_model 维度单头注意力的 8 倍。',
          isSignal: false,
          why: '因为每个头的维度降为了 d_k = d_model / 8（如 512 / 8 = 64），8 个低维头并行后的总计算成本与单个 512 维头相近。',
        },
        circuit: {
          q: 'Multi-Head Attention 相比单一全维度注意力最核心的表征收益是什么？',
          options: [
            '允许模型在同一位置同时关注来自不同表征子空间的多种关系模式',
            '直接省去了前馈神经网络层（FFN）',
            '使序列最大可输入长度扩大 h 倍',
            '避免使用任何线性投影矩阵',
          ],
          answer: '允许模型在同一位置同时关注来自不同表征子空间的多种关系模式',
          why: '不同线性投影头避免了单一 Softmax 权重把多种语义关系平均抵消。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 棱镜观测体',
          challengePrompt: '既然总维度都是 512，一个大头看全局不更完整吗？切成 8 个 64 维的小碎片难道不会管中窥豹？',
          keyPoints: [
            '单头 Softmax 平均化会掩盖多重并存的语义关系',
            '多组独立投影矩阵形成互补的表征子空间',
            '降维切分使总算力保持不变，最后拼接线性融合',
          ],
          followUpHint: '一句话里「它」既要在语法上找动词，又要在语义上找指代名词，一个 Softmax 分布能同时突出这两套不同规则吗？',
          referenceExplanation:
            '如果只有一个头，不同性质的关联挤在同一个概率分布里抢权重，最后只能折中模糊。切成 8 个子空间就像架起 8 台不同波段的望远镜，各看各的语法和指代，算力没涨，视野却立体了。',
          terms: ['表征子空间', '并行多头', '拼接投影'],
          decoyTerm: '最大池化',
        },
      },
      {
        id: 'zone-4',
        zoneTitle: '正弦位置编码星轨',
        title: '正弦位置编码星轨',
        zoneIntro: '用几何级数波长的 sin/cos 相位为无序集合刻上秩序，线性表达相对位移。',
        summary: '用几何级数波长的 sin/cos 相位为无序集合刻上秩序，线性表达相对位移。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 IV：自注意力天生具有置换不变性（打乱词序输出集合不变）；正弦余弦位置编码利用三角恒等式，使 PE(pos+k) 可表示为 PE(pos) 的线性变换，让模型天然习得相对距离。',
        intel: {
          conclusions: [
            '纯自注意力像装词的布袋，不加位置信息就分不清「狗咬人」和「人咬狗」',
            '不同维度绑定从 2π 到 10000·2π 递增波长的正弦与余弦波，叠加进词向量',
            '三角函数和角公式保证任意固定偏移 k 都能写成当前位置编码的线性矩阵变换',
          ],
          analogy: '像机械表的秒针、分针、时针以不同周期旋转，看一眼指针组合角度就知道精确时刻与时间差。',
        },
        calibration: {
          statement: '正弦位置编码之所以选 sin 和 cos 成对出现，是因为任意固定间距 k 的位置编码可表示为原位置编码的线性函数。',
          isSignal: true,
          why: '由 sin(ω(p+k)) = sin(ωp)cos(ωk) + cos(ωp)sin(ωk)，相对偏移 k 只对应一个与位置 p 无关的旋转矩阵。',
        },
        circuit: {
          q: '如果完全去掉 Positional Encoding，仅靠编码器自注意力层会发生什么？',
          options: [
            '对输入词序具有置换等价性，交换句中词序不会改变各词自身的语义混合集合',
            '矩阵维度无法对齐而报错崩溃',
            '解码器将无法输出概率分布',
            '梯度会在第一层直接爆炸为无穷大',
          ],
          answer: '对输入词序具有置换等价性，交换句中词序不会改变各词自身的语义混合集合',
          why: '点积与加权求和本身与元素排列顺序无关，必须靠外部注入位置信号打破对称性。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 相位司辰',
          challengePrompt: '给第 1 个词标 1、第 2 个词标 2 不就完事了吗？为什么要搞一堆不同频率的正弦余弦波加进词向量里？',
          keyPoints: [
            '纯整数标号在长句中数值过大，会污染词向量原本的语义尺度',
            '多频率 sin/cos 数值有界（-1 到 1）且每个位置编码唯一',
            '三角恒等式让固定相对距离 k 变成简单的线性旋转变换',
          ],
          followUpHint: '如果直接把整数 1, 2, ..., 1000 加到 [-1, 1] 量级的词向量上，第 1000 个词的语义还剩多少？',
          referenceExplanation:
            '直接加整数会让句尾数值淹没词义本身，而且遇到比训练集更长的句子就失控。多波长正弦余弦既把幅值稳稳锁在 [-1,1]，又像多根快慢指针一样用旋转角轻松算出任意两词相隔几步。',
          terms: ['置换不变性', '多波长相位', '相对位移'],
          decoyTerm: '批归一化',
        },
      },
      {
        id: 'zone-5',
        zoneTitle: '残差双塔与因果掩码',
        title: '残差双塔与因果掩码',
        zoneIntro: 'Encoder 双向建模全局语境，Decoder 借因果掩码与交叉注意力完成自回归创生。',
        summary: 'Encoder 双向建模全局语境，Decoder 借因果掩码与交叉注意力完成自回归创生。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 V：深层堆叠依靠 Add & LayerNorm 畅通梯度高速路；Decoder 自注意力将未来位置置为 -∞ 实施因果掩码（Causal Mask），再经 Cross-Attention 以解码端为 Query 检索编码端全局记忆 K/V。',
        intel: {
          conclusions: [
            '每层子模块都包裹残差连接与层归一化（Add & Norm），支撑深层稳定训练',
            '解码器训练时虽并行输入目标句，但用 -∞ 上三角掩码遮住未来词，严防偷看答案',
            '交叉注意力由 Decoder 出 Query，向 Encoder 输出的 Key/Value 按需提取源句信息',
          ],
          analogy: '译者一边遮住还没翻出的后半句草稿（因果掩码），一边随时抬头查阅原文全篇（交叉注意力）。',
        },
        calibration: {
          statement: '在编码器-解码器交叉注意力（Cross-Attention）中，Query 来自编码器，Key 和 Value 来自解码器。',
          isSignal: false,
          why: '恰好相反：Cross-Attention 的 Query 来自解码器上一层，而 Key 和 Value 来自编码器的全局输出记忆。',
        },
        circuit: {
          q: '解码器 Masked Self-Attention 把未来位置设为 -∞ 的根本作用是什么？',
          options: [
            '经 Softmax 后未来位置权重严格为 0，保证并行训练时仍维持自回归因果性',
            '随机丢弃神经元防止过拟合',
            '加速矩阵特征值分解',
            '压缩词表大小减少输出层计算',
          ],
          answer: '经 Softmax 后未来位置权重严格为 0，保证并行训练时仍维持自回归因果性',
          why: 'e^(-∞) = 0，确保预测第 t 个词时只能依赖小于 t 的已知输出，训练与推理逻辑一致。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 因果守门人',
          challengePrompt: '生成句子本来就该一个字一个字蹦，训练时把整句标准答案塞进解码器，难道不是当场作弊背答案吗？',
          keyPoints: [
            '上三角因果掩码把未来位置注意力分数设为负无穷，Softmax 权重归零',
            '第 t 步只能看见 t 之前的词，既不泄密又能一次性并行算完所有步的损失',
            '交叉注意力用解码器当前状态做 Query 去检索编码器的源文本 K/V',
          ],
          followUpHint: '加上那道上三角 -∞ 屏障之后，第 3 个位置还能收到第 4 个词的一丝信号吗？',
          referenceExplanation:
            '虽然整句答案一起送进了矩阵，但上三角 -∞ 掩码像单向百叶窗一样，让每个位置经 Softmax 后对未来词的权重严格为零。这样既守住了不偷看未来的因果铁律，又保住了训练时一步到位的并行速度。',
          terms: ['因果掩码', '交叉注意力', '残差归一化'],
          decoyTerm: '锚框回归',
        },
      },
    ],
  },
  {
    id: 'preset-thermodynamics',
    planetName: '「卡诺·熵增荒原」',
    fileName: 'Thermodynamics_Entropy_and_Time_Arrow.pdf',
    pages: 22,
    themeCategory: 'physics_math',
    themePalette: THEME_PALETTES.physics_math,
    themeSummary: '从卡诺热机效率极限到玻尔兹曼微观态统计，揭示能量耗散、信息擦除与时间之箭。',
    epigraph: '能量在宇宙账本上分毫不差，但唯有熵的阶梯单向攀升，为万物刻下了不可倒流的时间。',
    zones: [
      {
        id: 'zone-1',
        zoneTitle: '热平衡与内能账本',
        title: '热平衡与内能账本',
        zoneIntro: '第零定律确立温度标尺，第一定律以 dU = δQ - δW 锚定能量守恒底线。',
        summary: '第零定律确立温度标尺，第一定律以 dU = δQ - δW 锚定能量守恒底线。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 I：内能 U 是只取决于当前平衡态的状态函数，而热量 δQ 与功 δW 都是依赖演化路径的过程量；第一定律宣告第一类永动机绝无可能——功不会凭空诞生。',
        intel: {
          conclusions: [
            '热平衡具有传递性（第零定律），这让「温度计」测量万物冷热成为可能',
            '系统内能增量等于吸收的热量减去对外做的功（ΔU = Q - W）',
            '内能只看起点和终点状态，而做功和传热多少取决于中间怎么走',
          ],
          analogy: '内能就像银行账户余额（状态量），热量与做功则是汇款与刷卡流水（过程量）。',
        },
        calibration: {
          statement: '系统经历一个完整的循环过程回到初始热力学状态后，其内能变化量 ΔU 必为零。',
          isSignal: true,
          why: '内能 U 是状态函数，系统回到初态时 U_final = U_initial，故 ΔU = 0，此时净吸热等于净对外做功 Q = W。',
        },
        circuit: {
          q: '理想气体经历等温膨胀对外做功 W > 0 时，根据热力学第一定律必然发生什么？',
          options: [
            '理想气体内能只与温度有关（ΔU=0），必须从外界吸收等量的热量 Q = W',
            '气体无需吸热即可一直对外输出机械功',
            '气体内能增加量等于对外做功的两倍',
            '系统温度必然急剧下降至绝对零度',
          ],
          answer: '理想气体内能只与温度有关（ΔU=0），必须从外界吸收等量的热量 Q = W',
          why: '理想气体等温过程 ΔU = 0，由 ΔU = Q - W 可知对外做多少功就必须从热源吸多少热。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 守恒司衡',
          challengePrompt: '既然说一个物体「含有多少内能」是对的，为什么说它「含有多少热量」就被物理学家判为概念错误？',
          keyPoints: [
            '内能是平衡态固有的状态函数，只由当前状态决定',
            '热量与功只在状态变化过程中出现，属于过程量',
            '同一初末态可以通过不同做功与传热组合到达，但 ΔU 恒定',
          ],
          followUpHint: '你能看着水杯说它现在「含有多少做功」吗？热量和做功在账本上是什么角色？',
          referenceExplanation:
            '内能像水库里此刻存着的水位，只看当下状态；而热量和做功分别是下雨进水和开闸放水的过程动作。水进到水库里就统称内能了，脱离传输过程谈「存着多少热量」就像问账户里存着多少次转账动作一样矛盾。',
          terms: ['状态函数', '过程量', '能量守恒'],
          decoyTerm: '折射率',
        },
      },
      {
        id: 'zone-2',
        zoneTitle: '卡诺循环与效率极限',
        title: '卡诺循环与效率极限',
        zoneIntro: '两个等温与两个绝热准静态冲程，划定一切热机不可逾越的天花板 1 - T_C / T_H。',
        summary: '两个等温与两个绝热准静态冲程，划定一切热机不可逾越的天花板 1 - T_C / T_H。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 II：即使彻底消除摩擦与漏热，工作于高温源 T_H 与低温源 T_C 之间的任何热机，最高效率恒为 η_max = 1 - T_C / T_H；没有温差，海洋再庞大的内能也无法持续转化为有用功。',
        intel: {
          conclusions: [
            '不可能从单一热源吸热使之完全变成有用功而不产生其他影响（开尔文表述）',
            '卡诺可逆热机由「等温膨胀—绝热膨胀—等温压缩—绝热压缩」四步闭合组成',
            '最高效率只取决于冷热源热力学温差比 1 - T_C/T_H，与工作介质种类无关',
          ],
          analogy: '水车发电靠的是上下游水位落差；如果整片大海处于同一水平面，水再多也推不动水轮。',
        },
        calibration: {
          statement: '只要把工作气体换成导热更好的氦气并消除一切机械摩擦，热机效率就能突破 1 - T_C / T_H 达到 100%。',
          isSignal: false,
          why: '卡诺定理证明：所有工作在同温热源间的可逆热机效率完全相同且与工质无关，除非 T_C = 0K（不可达），否则效率永远小于 1。',
        },
        circuit: {
          q: '为什么热机每完成一次循环，都必须向低温冷源排出一部分废热 Q_C？',
          options: [
            '为了使工质熵减回到初态形成闭合循环，必须借助低温热源带走熵',
            '因为活塞材料无法承受高温必须水冷',
            '因为能量在循环中会自然凭空消失一部分',
            '纯粹是工程制造精度不足导致的漏气',
          ],
          answer: '为了使工质熵减回到初态形成闭合循环，必须借助低温热源带走熵',
          why: '从高温源吸热 Q_H 时工质熵增加了 Q_H/T_H，要复原工质状态必须向低温源放热至少 Q_C = Q_H·(T_C/T_H)。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 卡诺执政官',
          challengePrompt: '能量明明是守恒的！我造一台完美无摩擦的机器，抽干海水降温 1 度全拿去发电，又不违背第一定律，凭什么造不出来？',
          keyPoints: [
            '单一热源无法在不改变外界的情况下把热全部持续变成功',
            '工质要循环往复做功就必须压缩复原，必须向更低温冷源排热',
            '最高效率被热力学温标锁定在 1 - T_C / T_H',
          ],
          followUpHint: '活塞膨胀推完一程之后，如果没有更冷的地方让气体把热吐出去，你拿什么力气把它按回原位而又不多耗功？',
          referenceExplanation:
            '膨胀做功只有半程，想连续发电就得把膨胀后的热气体压回起点。如果在同一温度下硬压回去，刚赚来的功全得贴进去归零；只有借一个更冷的低温源把部分热量排走降压，压缩耗的功才比膨胀赚的功少，温差才是做功的通行证。',
          terms: ['卡诺效率', '冷热温差', '第二类永动机'],
          decoyTerm: '光电效应',
        },
      },
      {
        id: 'zone-3',
        zoneTitle: '克劳修斯熵与时间箭',
        title: '克劳修斯熵与时间箭',
        zoneIntro: '由 dS ≥ δQ / T 导出孤立系统熵增定律，为牛顿与量子可逆方程赋予宏观不可逆方向。',
        summary: '由 dS ≥ δQ / T 导出孤立系统熵增定律，为牛顿与量子可逆方程赋予宏观不可逆方向。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 III：可逆路径积分 ∫(δQ_rev / T) 定义了态函数熵 S；对绝热或孤立系统 δQ = 0，必有 ΔS ≥ 0，等号仅在可逆极限成立，一切自发不可逆演化皆向熵极大态奔流。',
        intel: {
          conclusions: [
            '同样 100 焦耳热量，在低温下比在高温下带来的熵变 ΔQ/T 更大，所以热自发流向冷处总是净增熵',
            '孤立系统的总熵永远不会减少（ΔS ≥ 0），达到热力学平衡时熵取极大值',
            '局部系统（如生命体、冰箱）可以熵减变有序，代价是向环境排放更多热量使总熵上升',
          ],
          analogy: '整理房间（局部熵减）会让房间变整齐，但你流汗散发的热量让整个宇宙的混乱度增加得更多。',
        },
        calibration: {
          statement: '地球上的生命从无序分子演化出高度精密的细胞结构，这直接推翻了热力学第二定律。',
          isSignal: false,
          why: '熵增定律只要求「孤立系统」总熵不减；生命体是开放系统，持续吸收低熵阳光并向太空辐射高熵红外热，宇宙总熵仍在增加。',
        },
        circuit: {
          q: '高温物体 T_H 向低温物体 T_C 自发传导微量热量 δQ（无对外做功）时，两物体总熵变 ΔS 是多少？',
          options: [
            'ΔS = δQ/T_C - δQ/T_H > 0，总熵严格增加',
            'ΔS = 0，因为一得一失正好抵消',
            'ΔS = δQ/T_H - δQ/T_C < 0，总熵减少',
            '总熵变与两者温度无关',
          ],
          answer: 'ΔS = δQ/T_C - δQ/T_H > 0，总熵严格增加',
          why: '因为 T_C < T_H，低温端增加的熵 δQ/T_C 大于高温端失去的熵 δQ/T_H，完美印证自发传热的不可逆性。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 时矢裁决者',
          challengePrompt: '冰箱每天都在把热量从冷室搬到暖屋，雪花也能自己结晶成完美六角形——熵增定律是不是到处都在漏水？',
          keyPoints: [
            'ΔS ≥ 0 严格适用于与外界无能量物质交换的孤立系统',
            '开放系统局部熵减必须依赖外部输入自由能或做功',
            '系统加环境的宇宙总熵变始终大于零，不可逆性确立了宏观时间之箭',
          ],
          followUpHint: '把冰箱门关上但拔掉电源插座，或者把整个密闭房间连同冰箱一起算总账，温度和总熵会怎么变？',
          referenceExplanation:
            '熵增管的是整个封闭大账本，不禁止局部小口袋变整齐。冰箱制冷靠压缩机耗电往外排了更多废热，雪花结晶释放潜热温暖了周围空气——把局部和环境合起来算总账，总熵依然毫无例外地在往上涨。',
          terms: ['孤立系统', '开放耗散', '时间之箭'],
          decoyTerm: '隧穿概率',
        },
      },
      {
        id: 'zone-4',
        zoneTitle: '玻尔兹曼微观态统计',
        title: '玻尔兹曼微观态统计',
        zoneIntro: '墓碑公式 S = k_B ln Ω 架起微观力学与宏观热学的桥梁，揭示不可逆的本质是高概率压倒性优势。',
        summary: '墓碑公式 S = k_B ln Ω 架起微观力学与宏观热学的桥梁，揭示不可逆的本质是高概率压倒性优势。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 IV：S = k_B ln Ω。两个独立子系统合并时微观态数相乘 Ω = Ω_1·Ω_2，取对数恰使熵具备可加性 S = S_1 + S_2；打翻的墨水不自己缩回一滴，不是微观定律禁止，而是均匀分布对应的 Ω 大出了天文指数级。',
        intel: {
          conclusions: [
            '宏观态是粗粒度的整体表现（如气压温度），微观态 Ω 是对应这一表现的所有分子位置动量排布数',
            '取对数 ln 让独立系统相乘的微观态数变成相加的宏观熵：ln(Ω1·Ω2) = ln Ω1 + ln Ω2',
            '熵增并非单颗分子受神秘力驱使，而是粒子数达 10^23 量级时，高 Ω 宏观态概率压倒一切',
          ],
          analogy: '抛 10000 枚硬币，全朝上只有 1 种排法，而五五开有天文数字种排法，随便一晃自然落进五五开。',
        },
        calibration: {
          statement: '玻尔兹曼公式中使用自然对数 ln Ω，保证了两个独立系统的总熵等于各自熵之和。',
          isSignal: true,
          why: '独立系统联合微观态数为乘积 Ω_total = Ω_A × Ω_B，唯独对数函数能将乘积精确映射为广延量加法 S_A + S_B。',
        },
        circuit: {
          q: '隔板抽开后，左侧 N 个理想气体分子自由膨胀充满整个双倍体积容器，微观态数与熵如何变化？',
          options: [
            '每个分子可用空间翻倍，位置微观态数变为 2^N 倍，熵增加 N·k_B·ln 2',
            '微观态数只变为原来的 2 倍，熵几乎不变',
            '因为自由膨胀不做功也不吸热，所以熵变为 0',
            '气体分子速度翻倍导致熵减少',
          ],
          answer: '每个分子可用空间翻倍，位置微观态数变为 2^N 倍，熵增加 N·k_B·ln 2',
          why: 'N 个独立分子各有 2 倍空间选择，总构型数乘上 2^N，代入 k_B ln(2^N) 即得 ΔS = N k_B ln 2。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 统计织命者',
          challengePrompt: '每个气体分子碰撞都严格遵守时间对称的牛顿定律，录像倒着放也完全合法——那凭什么整瓶气体偏偏不肯自己缩回左半边？',
          keyPoints: [
            '单个微观态概率相等，但不同宏观态包含的微观态数目 Ω 相差悬殊',
            '分子全部缩回左半边的概率是 (1/2)^N，当 N~10^23 时在宇宙寿命内几乎不可能发生',
            '宏观不可逆性源自大数统计下高 Ω 态的压倒性概率优势',
          ],
          followUpHint: '如果盒子里只有 3 颗分子，它们偶然全跑到左半边稀奇吗？换成 10^23 颗呢？',
          referenceExplanation:
            '微观碰撞确实可逆，3 颗分子时它们真的经常聚回左边。但一瓶气有 10^23 颗分子，均匀铺满对应的排布方式 Ω 比缩在一角多出了 2^(10^23) 倍；不是定律拦着它回去，而是外面的可能性浩瀚如星海，随机游走一旦散开就再也撞不回那唯一的小角落了。',
          terms: ['微观态数Ω', '对数可加性', '大数统计'],
          decoyTerm: '自旋轨道耦合',
        },
      },
      {
        id: 'zone-5',
        zoneTitle: '麦克斯韦妖与信息擦除',
        title: '麦克斯韦妖与信息擦除',
        zoneIntro: '兰道尔原理打通信息论与热力学：擦除 1 bit 记忆必耗散 k_B T ln 2 热量，第二定律金身不破。',
        summary: '兰道尔原理打通信息论与热力学：擦除 1 bit 记忆必耗散 k_B T ln 2 热量，第二定律金身不破。',
        status: 'completed',
        progress: 100,
        monolithNote:
          '星碑铭文 V：信息是物理的（Information is Physical）。麦克斯韦妖测量快慢分子虽可近乎无耗，但妖的有限存储器终将写满；擦除 1 比特信息是逻辑不可逆的多对一压缩，必然向环境至少释放 k_B T ln 2 的热熵，彻底闭合第二定律。',
        intel: {
          conclusions: [
            '麦克斯韦设想小妖按分子快慢开关小门制造温差，看似不耗功就能让熵减少',
            '小妖必须用物理存储器记录每个分子的快慢信息，有限内存终究会被写满',
            '兰道尔原理证明：重置擦除 1 bit 信息至少向环境散发 k_B T ln 2 热量，正好补齐减少的气体熵',
          ],
          analogy: '记账员靠分类记账帮仓库省了空间，但账本写满后粉碎旧账本耗的电刚好抵消省下的收益。',
        },
        calibration: {
          statement: '兰道尔原理指出，逻辑上不可逆地擦除 1 比特信息，在温度 T 下至少要向环境耗散 k_B T ln 2 的热量。',
          isSignal: true,
          why: '将未知的 0/1 两种可能状态统一重置为标准 0 态，存储器的信息熵减少 k_B ln 2，环境热熵必须至少增加同等大小。',
        },
        circuit: {
          q: '麦克斯韦妖思想实验最终是如何与热力学第二定律达成自洽的？',
          options: [
            '把小妖存储器的信息记录与擦除纳入热力学循环，擦除记忆产生的环境熵增抵消了气体的熵减',
            '证明小妖根本看不清气体分子的运动',
            '宣告热力学第二定律在分子尺度彻底失效',
            '规定小门的质量必须无穷大',
          ],
          answer: '把小妖存储器的信息记录与擦除纳入热力学循环，擦除记忆产生的环境熵增抵消了气体的熵减',
          why: '西拉德引擎与兰道尔擦除原理表明，要让小妖自身存储器也复原成完整循环，擦除信息产生的热熵 ≥ 气体减少的熵。',
        },
        feynmanBoss: {
          guardianName: 'GUARDIAN // 兰道尔守门妖',
          challengePrompt: '我这扇纳米小门轻若无物，只让快分子往左、慢分子往右，一根手指的功都没做就造出了温差——第二定律是不是终于被「知识」打败了？',
          keyPoints: [
            '信息必须依托物理载体存储，小妖脑中记录了分子状态信息',
            '真正构成循环必须清空重置有限容量的存储器',
            '擦除 1 比特信息（二态合一）至少向环境排热 k_B T ln 2，总熵不减',
          ],
          followUpHint: '小妖的脑容量有限，当它记满了成千上万颗分子的快慢想要清空重来时，存储器发生了什么变化？',
          referenceExplanation:
            '信息不是虚无的幽灵，它刻在物理比特上。小妖挑拣分子只是把气体的混乱转移进了自己脑中的记忆比特里；等内存满了必须格式化清零时，把 0 和 1 强行压回同一种初态必然向周围发热 k_B T ln 2，省下的熵一分不少全还给了宇宙。',
          terms: ['麦克斯韦妖', '兰道尔擦除', '信息物理性'],
          decoyTerm: '多普勒红移',
        },
      },
    ],
  },
];

export function getPresetPlanet(docId?: string | null): PresetPlanetSpec | undefined {
  if (!docId) return undefined;
  return PRESET_PLANETS.find((p) => p.id === docId);
}

export function createPresetZoneSave(spec: PresetPlanetSpec, completed = true): ZoneSave {
  const zones: KnowledgeZone[] = spec.zones.map((z, idx) => ({
    ...z,
    status: completed ? 'completed' : idx === 0 ? 'active' : 'locked',
    progress: completed ? 100 : idx === 0 ? 12 : 0,
  }));
  const phases: ZoneSave['phases'] = {};
  const resonance: ZoneSave['resonance'] = {};
  const briefed: ZoneSave['briefed'] = {};
  if (completed) {
    zones.forEach((z) => {
      phases[z.id] = 2;
      resonance[z.id] = 100;
      briefed[z.id] = true;
    });
  }
  return {
    zones,
    phases,
    resonance,
    briefed,
    source: 'preset',
  };
}
