/*
 * Text Review Studio v0.4.0
 * Local-only, dependency-free two-stage diff core.
 *
 * Design goals:
 * - Never duplicate tokens in reconstruction.
 * - Keep long documents responsive by diffing line blocks first.
 * - Assign stable hunk IDs to changed blocks for rendering and review.
 */
(function (root) {
  'use strict';

  const MAX_LINE_CELLS = 220000;
  const MAX_CHAR_CELLS = 240000;

  function compact(parts) {
    const out = [];
    for (const part of parts) {
      if (!part || !part.value) continue;
      const previous = out[out.length - 1];
      if (previous && previous.type === part.type && previous.hunkId === part.hunkId) {
        previous.value += part.value;
      } else {
        out.push({ ...part });
      }
    }
    return out;
  }

  function splitLines(text) {
    if (text === '') return [];
    const raw = String(text).split('\n');
    return raw.map((line, index) => index < raw.length - 1 ? `${line}\n` : line);
  }

  function splitChars(text) {
    return Array.from(String(text));
  }

  function commonEdgeDiff(a, b) {
    let start = 0;
    const min = Math.min(a.length, b.length);
    while (start < min && a[start] === b[start]) start += 1;

    let endA = a.length - 1;
    let endB = b.length - 1;
    while (endA >= start && endB >= start && a[endA] === b[endB]) {
      endA -= 1;
      endB -= 1;
    }

    const parts = [];
    if (start > 0) parts.push({ type: 'same', values: a.slice(0, start) });
    if (endA >= start) parts.push({ type: 'remove', values: a.slice(start, endA + 1) });
    if (endB >= start) parts.push({ type: 'add', values: b.slice(start, endB + 1) });
    if (endA < a.length - 1) parts.push({ type: 'same', values: a.slice(endA + 1) });
    return parts;
  }

  /**
   * LCS diff. For oversized matrices, preserves shared prefix/suffix and treats
   * the middle as a single replace block. That is less granular, but still exact.
   */
  function lcsDiff(a, b, maxCells) {
    const n = a.length;
    const m = b.length;
    if (!n && !m) return [];
    if (!n) return [{ type: 'add', values: b.slice() }];
    if (!m) return [{ type: 'remove', values: a.slice() }];
    if (n * m > maxCells) return commonEdgeDiff(a, b);

    const width = m + 1;
    const dp = new Uint32Array((n + 1) * (m + 1));
    const at = (i, j) => i * width + j;

    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        dp[at(i, j)] = a[i] === b[j]
          ? dp[at(i + 1, j + 1)] + 1
          : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
      }
    }

    const raw = [];
    const push = (type, value) => {
      const last = raw[raw.length - 1];
      if (last && last.type === type) last.values.push(value);
      else raw.push({ type, values: [value] });
    };

    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        push('same', a[i]);
        i += 1;
        j += 1; // Critical: move both sides. Prevents duplicate additions.
      } else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) {
        push('remove', a[i]);
        i += 1;
      } else {
        push('add', b[j]);
        j += 1;
      }
    }
    while (i < n) {
      push('remove', a[i]);
      i += 1;
    }
    while (j < m) {
      push('add', b[j]);
      j += 1;
    }
    return raw;
  }

  function classifySeverity(before, after) {
    const combined = `${before}${after}`;
    if (/(https?:\/\/|www\.|@[\w.-]+\.|<\/?[A-Za-z][^>]*>|[0-9０-９]+\s*(年|月|日|時|分|円|%|％)|\b(?:AM|PM)\b)/i.test(combined)) {
      return 'critical';
    }
    if (/^[\s\n\r\t、。,.!！?？()（）\[\]【】「」『』]+$/u.test(combined)) return 'minor';
    return 'normal';
  }

  function textFromOps(ops) {
    return ops.map(op => op.values.join('')).join('');
  }

  function diffChangedBlock(beforeText, afterText, hunkId, beforeStart, afterStart) {
    if (!beforeText && !afterText) return [];
    if (!beforeText) return [{ type: 'add', value: afterText, hunkId, beforeStart, afterStart }];
    if (!afterText) return [{ type: 'remove', value: beforeText, hunkId, beforeStart, afterStart }];

    const charOps = lcsDiff(splitChars(beforeText), splitChars(afterText), MAX_CHAR_CELLS);
    const parts = [];
    let bPos = beforeStart;
    let aPos = afterStart;

    for (const op of charOps) {
      const value = op.values.join('');
      if (!value) continue;
      parts.push({
        type: op.type,
        value,
        hunkId: op.type === 'same' ? null : hunkId,
        beforeStart: bPos,
        afterStart: aPos
      });
      if (op.type !== 'add') bPos += value.length;
      if (op.type !== 'remove') aPos += value.length;
    }
    return parts;
  }

  function diffText(beforeText, afterText) {
    const before = String(beforeText || '');
    const after = String(afterText || '');
    const lineOps = lcsDiff(splitLines(before), splitLines(after), MAX_LINE_CELLS);

    const parts = [];
    const hunks = [];
    let beforePos = 0;
    let afterPos = 0;
    let i = 0;
    let hunkCounter = 0;

    while (i < lineOps.length) {
      const op = lineOps[i];
      if (op.type === 'same') {
        const value = textFromOps([op]);
        parts.push({ type: 'same', value, hunkId: null, beforeStart: beforePos, afterStart: afterPos });
        beforePos += value.length;
        afterPos += value.length;
        i += 1;
        continue;
      }

      const startBefore = beforePos;
      const startAfter = afterPos;
      let removed = '';
      let added = '';

      while (i < lineOps.length && lineOps[i].type !== 'same') {
        const current = lineOps[i];
        const value = textFromOps([current]);
        if (current.type === 'remove') {
          removed += value;
          beforePos += value.length;
        } else {
          added += value;
          afterPos += value.length;
        }
        i += 1;
      }

      const hunkId = `diff-${hunkCounter + 1}`;
      hunkCounter += 1;
      const kind = removed && added ? 'replace' : removed ? 'delete' : 'insert';
      hunks.push({
        id: hunkId,
        kind,
        before: removed,
        after: added,
        beforeStart: startBefore,
        beforeEnd: startBefore + removed.length,
        afterStart: startAfter,
        afterEnd: startAfter + added.length,
        severity: classifySeverity(removed, added)
      });
      parts.push(...diffChangedBlock(removed, added, hunkId, startBefore, startAfter));
    }

    return { parts: compact(parts), hunks };
  }

  function reconstructBefore(parts) {
    return parts.filter(part => part.type !== 'add').map(part => part.value).join('');
  }

  function reconstructAfter(parts) {
    return parts.filter(part => part.type !== 'remove').map(part => part.value).join('');
  }

  const api = {
    diffText,
    reconstructBefore,
    reconstructAfter,
    _lcsDiff: lcsDiff
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.TextReviewDiffCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
