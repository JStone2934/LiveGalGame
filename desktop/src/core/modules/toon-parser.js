const HEADER_REGEX = /^suggestions\[(\d+)\]\{([^}]+)\}:\s*$/i;

const INLINE_ROW_REGEX = /^suggestions\[(\d+)\]\{([^}]+)\}\s*;?\s*$/i;

const STRING_QUOTES = /^["'“”]|["'“”]$/g;

const DEFAULT_FIELDS = ['suggestion', 'tags'];

const normalizeValue = (value = '') => {
  let v = value.trim();
  // 处理成对的中文引号
  if (v.startsWith('“') && v.endsWith('”')) {
    v = v.slice(1, -1);
  } else if (v.startsWith('‘') && v.endsWith('’')) {
    v = v.slice(1, -1);
  }
  return v.replace(STRING_QUOTES, '').trim();
};

// 针对 suggestion/tags，取“最后一个未被引号包裹的逗号（中/英文）”作为分隔
const splitByLastDelimiter = (line) => {
  let inQuotes = false;
  let quoteChar = null;
  let lastIndex = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === '“' || char === '”') && line[i - 1] !== '\\') {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else {
        // 如果是匹配的引号或者是结束引号，则结束
        if (char === '"' || (quoteChar === '“' && char === '”') || (quoteChar === char)) {
          inQuotes = false;
          quoteChar = null;
        }
      }
      continue;
    }
    if (!inQuotes && (char === ',' || char === '，')) {
      lastIndex = i;
    }
  }
  if (lastIndex === -1) return [line];
  return [line.slice(0, lastIndex), line.slice(lastIndex + 1)];
};

const parseTags = (raw) => {
  if (!raw) return [];
  const cleaned = normalizeValue(raw);
  if (!cleaned) return [];
  return cleaned
    .split(/[,，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const csvSplit = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === '“' || char === '”') && line[i - 1] !== '\\') {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else {
        if (char === '"' || (quoteChar === '“' && char === '”') || (quoteChar === char)) {
          inQuotes = false;
          quoteChar = null;
        }
      }
      continue;
    }
    if ((char === ',' || char === '，') && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current !== '' || line.endsWith(',') || line.endsWith('，')) {
    result.push(current);
  }
  return result;
};

// affinity_delta 范围：0-10（对方接受度预测）
const parseAffinityDelta = (raw) => {
  if (raw === undefined || raw === null) return null;
  const text = normalizeValue(String(raw));
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (Number.isNaN(parsed)) return null;
  return Math.max(0, Math.min(10, parsed));
};

export class ToonSuggestionStreamParser {
  constructor({ onHeader, onSuggestion, onPartialSuggestion, onError, onSkip } = {}) {
    this.onHeader = onHeader;
    this.onSuggestion = onSuggestion;
    this.onPartialSuggestion = onPartialSuggestion;
    this.onError = onError;
    this.onSkip = onSkip;  // 新增: SKIP 回调
    this.buffer = '';
    this.headerParsed = false;
    this.skipDetected = false;  // 新增: SKIP 状态标记
    this.expectedCount = null;
    this.fields = DEFAULT_FIELDS;
    this.headerSkipCount = 0;
    this.MAX_HEADER_SKIP = 5;
  }

  push(chunk) {
    if (!chunk) {
      console.log('[ToonSuggestionStreamParser] Received empty chunk, skipping');
      return;
    }

    console.log(`[ToonSuggestionStreamParser] Received chunk (${chunk.length} chars): "${chunk.replace(/\n/g, '\\n')}"`);
    this.buffer += chunk;
    console.log(`[ToonSuggestionStreamParser] Buffer length: ${this.buffer.length}`);

    let newlineIndex = this.buffer.indexOf('\n');
    let lineCount = 0;
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      console.log(`[ToonSuggestionStreamParser] Processing line ${++lineCount}: "${line}"`);
      this.processLine(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
    // 将当前未结束的行以 partial 形式暴露，便于前端流式展示
    // 只有在 header 已解析后才发送 partial，避免把 header 内容误当作 suggestion
    if (typeof this.onPartialSuggestion === 'function' && this.headerParsed) {
      const partialLine = this.buffer.trim();
      if (partialLine) {
        this.onPartialSuggestion({
          suggestion: normalizeValue(partialLine),
          tags: []
        });
      }
    }

    console.log(`[ToonSuggestionStreamParser] Remaining buffer (${this.buffer.length} chars): "${this.buffer}"`);
  }

  end() {
    console.log('[ToonSuggestionStreamParser] Stream ended, processing remaining buffer');
    const remaining = this.buffer.trim();
    if (remaining) {
      console.log(`[ToonSuggestionStreamParser] Processing remaining line: "${remaining}"`);
      this.processLine(remaining);
    } else {
      console.log('[ToonSuggestionStreamParser] No remaining content in buffer');
    }
    this.buffer = '';
    console.log('[ToonSuggestionStreamParser] Parser finished');
  }

  processLine(line) {
    if (!line) {
      console.log('[ToonSuggestionStreamParser] Skipping empty line');
      return;
    }

    // 检测 SKIP 信号（不需要建议）
    const trimmed = line.trim();
    if (trimmed === 'SKIP' || trimmed.toUpperCase() === 'SKIP') {
      console.log('[ToonSuggestionStreamParser] Detected SKIP signal');
      this.skipDetected = true;
      if (typeof this.onSkip === 'function') {
        this.onSkip({ reason: 'no_suggestion_needed' });
      }
      return;
    }

    // 如果已经检测到SKIP，忽略后续所有内容
    if (this.skipDetected) {
      return;
    }

    // 处理某些模型可能出现的每行都带 suggestions[N]{...} 的变体格式
    const inlineMatch = line.match(INLINE_ROW_REGEX);
    if (inlineMatch && !line.match(HEADER_REGEX)) {
      console.log('[ToonSuggestionStreamParser] Detected inline row format');
      const count = Number(inlineMatch[1]);
      const content = inlineMatch[2];

      if (!this.headerParsed) {
        console.log('[ToonSuggestionStreamParser] Implicitly parsing header from inline row');
        this.expectedCount = count;
        this.fields = ['suggestion', 'affinity_delta', 'tags'];
        this.headerParsed = true;
        if (typeof this.onHeader === 'function') {
          this.onHeader({ expectedCount: this.expectedCount, fields: this.fields });
        }
      }

      this.parseRow(content);
      return;
    }

    const lower = line.toLowerCase();
    const normalizedToon = lower.replace(/[`]/g, '').replace(/\s/g, '');
    if (
      normalizedToon === 'toon' ||
      (lower.startsWith('```') && lower.includes('toon')) ||
      lower === '```toon' ||
      lower.startsWith('toon```')
    ) {
      console.log('[ToonSuggestionStreamParser] Skipping code fence/toon marker line:', line);
      return;
    }
    if (!this.headerParsed) {
      console.log('[ToonSuggestionStreamParser] Header not parsed yet, parsing header');
      this.parseHeader(line);
      return;
    }
    console.log('[ToonSuggestionStreamParser] Parsing data row');
    this.parseRow(line);
  }

  parseHeader(line) {
    console.log(`[ToonSuggestionStreamParser] Attempting to parse header: "${line}"`);
    const match = line.match(HEADER_REGEX);
    if (!match) {
      // 容忍若干行非表头文本（模型可能输出客套或提示语）
      const shouldSkip =
        /^```/.test(line) ||
        /^(好的|以下|这里|结果|建议|总结|输出)/i.test(line) ||
        /^(toon:?)$/i.test(line);
      if (shouldSkip && this.headerSkipCount < this.MAX_HEADER_SKIP) {
        this.headerSkipCount += 1;
        console.warn(
          `[ToonSuggestionStreamParser] Skipping non-header line (${this.headerSkipCount}/${this.MAX_HEADER_SKIP}): "${line}"`
        );
        return;
      }

      this.headerSkipCount += 1;
      if (this.headerSkipCount <= this.MAX_HEADER_SKIP) {
        console.warn(
          `[ToonSuggestionStreamParser] Non-header line tolerated (${this.headerSkipCount}/${this.MAX_HEADER_SKIP}): "${line}"`
        );
        return;
      }

      console.error(`[ToonSuggestionStreamParser] Header format invalid after tolerance: "${line}"`);
      this.emitError(new Error(`TOON 表头格式不正确：${line}`));
      return;
    }

    this.headerParsed = true;
    this.expectedCount = Number(match[1]);
    console.log(`[ToonSuggestionStreamParser] Parsed expected count: ${this.expectedCount}`);

    const fieldList = match[2]
      .split(',')
      .map((field) => {
        const f = field.trim();
        // 映射常见的中文表头到标准字段名
        if (f === '建议内容' || f === '建议') return 'suggestion';
        if (f === '好感度变化' || f === '好感变化' || f === '好感变化预测') return 'affinity_delta';
        if (f === '标签' || f === '策略标签') return 'tags';
        return f;
      })
      .filter(Boolean);
    console.log(`[ToonSuggestionStreamParser] Parsed fields: [${fieldList.join(', ')}]`);

    if (fieldList.length) {
      this.fields = fieldList;
    }

    if (typeof this.onHeader === 'function') {
      console.log('[ToonSuggestionStreamParser] Calling onHeader callback');
      this.onHeader({
        expectedCount: this.expectedCount,
        fields: this.fields
      });
    } else {
      console.warn('[ToonSuggestionStreamParser] No onHeader callback provided');
    }
  }

  parseRow(line) {
    console.log(`[ToonSuggestionStreamParser] Parsing row: "${line}"`);

    // 跳过纯分隔符/占位符行（如 ..., …, ---, ``` 等）
    const symbolicOnly = line.trim().replace(/\s/g, '');
    if (
      !symbolicOnly ||
      /^(```|---|—{2,}|\.{2,}|…+|={2,})$/i.test(symbolicOnly)
    ) {
      console.log('[ToonSuggestionStreamParser] Skipping non-content row:', line);
      return;
    }

    const isSuggestionOnly =
      this.fields.length === 2 &&
      this.fields.includes('suggestion') &&
      this.fields.includes('tags');

    const isSuggestionAffinityTags =
      this.fields.length === 3 &&
      this.fields[0] === 'suggestion' &&
      this.fields[1] === 'affinity_delta' &&
      this.fields[2] === 'tags';

    let values = [];
    if (isSuggestionOnly) {
      values = splitByLastDelimiter(line);
    } else if (isSuggestionAffinityTags) {
      // 更加稳健的切分策略：寻找符合好感度变化（数字）的部分作为锚点
      const allParts = csvSplit(line);
      let affinityIndex = -1;
      for (let i = allParts.length - 1; i >= 0; i -= 1) {
        const val = normalizeValue(allParts[i]);
        if (/^[+-]?\d+$/.test(val)) {
          affinityIndex = i;
          break;
        }
      }

      if (affinityIndex !== -1) {
        const suggestionRaw = allParts.slice(0, affinityIndex).join('，');
        const affinityRaw = allParts[affinityIndex];
        const tagsRaw = allParts.slice(affinityIndex + 1).join('，');
        values = [suggestionRaw, affinityRaw, tagsRaw];
      } else {
        // 退化方案
        const parts = splitByLastDelimiter(line);
        const left = parts[0] ?? '';
        const tagsRaw = parts[1] ?? '';
        const parts2 = splitByLastDelimiter(left);
        const suggestionRaw = parts2[0] ?? '';
        const affinityRaw = parts2[1] ?? '';
        values = [suggestionRaw, affinityRaw, tagsRaw];
      }
    } else {
      values = csvSplit(line);
    }

    console.log(`[ToonSuggestionStreamParser] Parsed CSV values: [${values.map(v => `"${v}"`).join(', ')}]`);

    if (!values.length) {
      console.log('[ToonSuggestionStreamParser] No values parsed, skipping');
      return;
    }

    const suggestion = {};
    this.fields.forEach((field, index) => {
      suggestion[field] = values[index] !== undefined ? normalizeValue(values[index]) : '';
    });

    console.log(`[ToonSuggestionStreamParser] Mapped suggestion:`, suggestion);

    const normalized = {
      suggestion: suggestion.suggestion || suggestion.title || suggestion.content || `选项`,
      tags: parseTags(suggestion.tags || suggestion.tag_list || ''),
      affinity_delta: parseAffinityDelta(suggestion.affinity_delta)
    };

    console.log(`[ToonSuggestionStreamParser] Normalized suggestion:`, normalized);

    if (typeof this.onSuggestion === 'function') {
      console.log('[ToonSuggestionStreamParser] Calling onSuggestion callback');
      this.onSuggestion(normalized);
    } else {
      console.warn('[ToonSuggestionStreamParser] No onSuggestion callback provided');
    }
  }

  emitError(error) {
    if (typeof this.onError === 'function') {
      this.onError(error);
    } else {
      console.warn('[ToonSuggestionStreamParser]', error);
    }
  }
}

export const createToonSuggestionStreamParser = (options) =>
  new ToonSuggestionStreamParser(options);
