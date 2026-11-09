/**
 * Server-side strings the learner reads: build progress, local grading verdicts, key and model
 * errors. The model's own output (feedback, items, reports) is steered by the language note in
 * the prompts instead (see languageNote). English is the key and the fallback.
 */
import type { Language } from "@mastery/shared";

export type Lang = "en" | "zh-Hans" | "zh-Hant";

/** The language to write server messages in: the setting, else the client's hint, else English. */
export function resolveLang(setting: Language | undefined, hint?: string | null): Lang {
  if (setting && setting !== "auto") return setting;
  const h = (hint ?? "").toLowerCase();
  if (h.startsWith("zh")) return /hant|tw|hk|mo/.test(h) ? "zh-Hant" : "zh-Hans";
  return "en";
}

/** Fill {name} placeholders. */
function fill(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export type Translate = (template: string, vars?: Record<string, string | number>) => string;

export function translator(lang: Lang): Translate {
  const dict = lang === "en" ? {} : DICT[lang];
  return (template, vars) => fill(dict[template] ?? template, vars);
}

/** The sentence prepended to every prompt that fixes the output language. */
export function languageNote(setting: Language | undefined, hint?: string | null): string {
  const lang = resolveLang(setting, hint);
  if (setting === "auto" || !setting) {
    return "Write every prose field (feedback, probes, reports, item prompts, answer keys, rubric criteria, summaries) in the language of the source material. If the learner's answer is in a different language from the source, write feedback in the learner's language and quote the source in its own. Keep technical terms as the source writes them, with a gloss on first use where a translation would be ambiguous.";
  }
  const name = lang === "zh-Hans" ? "Simplified Chinese (简体中文)" : lang === "zh-Hant" ? "Traditional Chinese (繁體中文)" : "English";
  return `Write every prose field (feedback, probes, reports, item prompts, answer keys, rubric criteria, summaries) in ${name}, whatever language the source material is in. Quote the source verbatim in its own language where a quotation is needed, and keep technical terms in the source language in parentheses on first use when the ${name} term is not standard.`;
}

const ZH_HANS: Record<string, string> = {
  // build progress (generate/buildCourse.ts)
  "Reading {n} sources": "正在读取 {n} 个来源",
  "Reading {n} source": "正在读取 1 个来源",
  "Reading {title} ({i} of {n})": "正在读取 {title}（第 {i} 个，共 {n} 个）",
  "Skipping {title}: it has no extractable text": "跳过 {title}：没有可提取的文字",
  "Summarising {chunks} chunks ({k}k characters) in {passes} passes": "正在分 {passes} 轮概括 {chunks} 个段落（约 {k} 千字）",
  "Summarised {done} of {total} chunks": "已概括 {done} / {total} 个段落",
  "Outlining up to {cap} topics from {n} sources": "正在从 {n} 个来源拟定最多 {cap} 个主题",
  "Outlining up to {cap} topics from {n} source": "正在从 1 个来源拟定最多 {cap} 个主题",
  "Keeping the first {cap} of {n} proposed topics (depth {depth})": "保留 {n} 个候选主题中的前 {cap} 个（深度：{depth}）",
  "Dropped an unknown prerequisite {title} from {topic}": "已从 {topic} 中移除无法识别的前置主题 {title}",
  "Dropped a prerequisite that would loop: {other} already depends on {topic}": "已移除一个会形成循环的前置关系：{other} 已依赖 {topic}",
  "Outlined {n} topics": "已拟定 {n} 个主题",
  "Outlined {n} topic": "已拟定 1 个主题",
  " ({n} without a cited chunk; items will search the sources)": "（其中 {n} 个未引用具体段落；题目将自行检索来源）",
  "Writing items for {title} ({i} of {n})": "正在为 {title} 编写题目（第 {i} 个，共 {n} 个）",
  "Wrote {k} items for {title} ({done} of {n} topics done)": "已为 {title} 编写 {k} 道题（{done} / {n} 个主题完成）",
  "Checking {n} items": "正在检查 {n} 道题",
  "{title} has no usable items yet; it stays in the course so you can rebuild it": "{title} 暂无可用题目；该主题保留在课程中，可稍后重建",
  "Built {title}: {topics} topics, {items} items, {calls} model calls, about ${cost}": "已生成 {title}：{topics} 个主题，{items} 道题，{calls} 次模型调用，约 ${cost}",
  "Dropped an item with no prompt in {topic}": "已移除 {topic} 中一道没有题干的题目",
  "Built {title}: {topics} topics, {items} items": "已生成 {title}：{topics} 个主题，{items} 道题",
  "Starting": "正在开始",
  // jobs.ts
  "Transcribing {n} scanned pages": "正在识别 {n} 页扫描件",
  "Transcribed {n} pages · about ${cost}": "已识别 {n} 页 · 约 ${cost}",
  "Failed: {error}": "失败：{error}",
  "The source or its original file is missing.": "找不到该来源或它的原始文件。",
  // grader.ts (local verdicts)
  "Correct.": "正确。",
  "Incorrect. You chose: {picked}\n\nThe answer is: {answer}\n\n{key}": "不正确。你选择了：{picked}\n\n正确答案是：{answer}\n\n{key}",
  "No answer recorded.\n\nThe answer is: {answer}": "未记录答案。\n\n正确答案是：{answer}",
  "No answer given. Skipped items are recorded as zero. That is data, not a judgement.": "未作答。跳过的题目记为 0 分。这是数据，不是评判。",
  "Grading failed for this item: {error}": "这道题评分失败：{error}",
  // llm.ts / keys.ts / sessions.ts
  "No API key yet. Add your Anthropic key in Settings, or choose the managed key.": "尚未设置 API 密钥。请在设置中添加你的 Anthropic 密钥，或选择托管密钥。",
  "Anthropic rejected the API key. Check it in Settings.": "Anthropic 拒绝了该 API 密钥。请在设置中检查。",
  "Rate limited by the API. Wait a minute and try again.": "已触发 API 速率限制。请稍等一分钟后重试。",
  "Could not reach the Anthropic API.": "无法连接 Anthropic API。",
  "The grader declined to respond to this item.": "评分模型拒绝回应这道题。",
  "The grader ran out of room. Try again.": "评分模型输出超出长度限制。请重试。",
  "No responses submitted.": "没有提交任何回答。",
  "Nothing is due and there is no new material in the selected courses. That is the system working: come back when items come due.": "所选课程中没有到期的题目，也没有新材料。这正是系统在正常运作：等题目到期后再来。",
  "No courses yet. Drop a source into the library and build one.": "还没有课程。把一个来源放进资料库，然后生成一门。",
};

const ZH_HANT: Record<string, string> = {
  "Reading {n} sources": "正在讀取 {n} 個來源",
  "Reading {n} source": "正在讀取 1 個來源",
  "Reading {title} ({i} of {n})": "正在讀取 {title}（第 {i} 個，共 {n} 個）",
  "Skipping {title}: it has no extractable text": "略過 {title}：沒有可擷取的文字",
  "Summarising {chunks} chunks ({k}k characters) in {passes} passes": "正在分 {passes} 輪摘要 {chunks} 個段落（約 {k} 千字）",
  "Summarised {done} of {total} chunks": "已摘要 {done} / {total} 個段落",
  "Outlining up to {cap} topics from {n} sources": "正在從 {n} 個來源擬定最多 {cap} 個主題",
  "Outlining up to {cap} topics from {n} source": "正在從 1 個來源擬定最多 {cap} 個主題",
  "Keeping the first {cap} of {n} proposed topics (depth {depth})": "保留 {n} 個候選主題中的前 {cap} 個（深度：{depth}）",
  "Dropped an unknown prerequisite {title} from {topic}": "已從 {topic} 移除無法辨識的先修主題 {title}",
  "Dropped a prerequisite that would loop: {other} already depends on {topic}": "已移除一個會形成循環的先修關係：{other} 已依賴 {topic}",
  "Outlined {n} topics": "已擬定 {n} 個主題",
  "Outlined {n} topic": "已擬定 1 個主題",
  " ({n} without a cited chunk; items will search the sources)": "（其中 {n} 個未引用具體段落；題目將自行檢索來源）",
  "Writing items for {title} ({i} of {n})": "正在為 {title} 撰寫題目（第 {i} 個，共 {n} 個）",
  "Wrote {k} items for {title} ({done} of {n} topics done)": "已為 {title} 撰寫 {k} 道題（{done} / {n} 個主題完成）",
  "Checking {n} items": "正在檢查 {n} 道題",
  "{title} has no usable items yet; it stays in the course so you can rebuild it": "{title} 暫無可用題目；該主題保留在課程中，可稍後重建",
  "Built {title}: {topics} topics, {items} items, {calls} model calls, about ${cost}": "已建立 {title}：{topics} 個主題，{items} 道題，{calls} 次模型呼叫，約 ${cost}",
  "Dropped an item with no prompt in {topic}": "已移除 {topic} 中一道沒有題幹的題目",
  "Built {title}: {topics} topics, {items} items": "已建立 {title}：{topics} 個主題，{items} 道題",
  "Starting": "正在開始",
  "Transcribing {n} scanned pages": "正在辨識 {n} 頁掃描件",
  "Transcribed {n} pages · about ${cost}": "已辨識 {n} 頁 · 約 ${cost}",
  "Failed: {error}": "失敗：{error}",
  "The source or its original file is missing.": "找不到該來源或它的原始檔案。",
  "Correct.": "正確。",
  "Incorrect. You chose: {picked}\n\nThe answer is: {answer}\n\n{key}": "不正確。你選擇了：{picked}\n\n正確答案是：{answer}\n\n{key}",
  "No answer recorded.\n\nThe answer is: {answer}": "未記錄答案。\n\n正確答案是：{answer}",
  "No answer given. Skipped items are recorded as zero. That is data, not a judgement.": "未作答。略過的題目記為 0 分。這是資料，不是評判。",
  "Grading failed for this item: {error}": "這道題評分失敗：{error}",
  "No API key yet. Add your Anthropic key in Settings, or choose the managed key.": "尚未設定 API 金鑰。請在設定中加入你的 Anthropic 金鑰，或選擇託管金鑰。",
  "Anthropic rejected the API key. Check it in Settings.": "Anthropic 拒絕了該 API 金鑰。請在設定中檢查。",
  "Rate limited by the API. Wait a minute and try again.": "已觸發 API 速率限制。請稍候一分鐘後重試。",
  "Could not reach the Anthropic API.": "無法連線至 Anthropic API。",
  "The grader declined to respond to this item.": "評分模型拒絕回應這道題。",
  "The grader ran out of room. Try again.": "評分模型輸出超過長度上限。請重試。",
  "No responses submitted.": "沒有提交任何回答。",
  "Nothing is due and there is no new material in the selected courses. That is the system working: come back when items come due.": "所選課程中沒有到期的題目，也沒有新材料。這正是系統在正常運作：等題目到期後再來。",
  "No courses yet. Drop a source into the library and build one.": "還沒有課程。把一個來源放進資料庫，然後建立一門。",
};

const DICT: Record<Exclude<Lang, "en">, Record<string, string>> = { "zh-Hans": ZH_HANS, "zh-Hant": ZH_HANT };

/** Pick the singular or plural English template (Chinese dictionaries carry both keys). */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}
