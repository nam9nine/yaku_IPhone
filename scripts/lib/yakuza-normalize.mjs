import { createHash } from 'node:crypto';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const languageField = /^([a-z][a-z0-9_-]*)_text$/i;

function inspectSourceKey(rawKey) {
  const empty = { container: null, sceneCandidate: null, tablePosition: null };
  if (rawKey === undefined || rawKey === null || rawKey === '') {
    return { ...empty, parseStatus: 'missing', field: null };
  }
  if (typeof rawKey !== 'string') {
    return { ...empty, parseStatus: 'invalid', field: null };
  }

  const containerMatch = /^([^@\r\n]+\.json)@/.exec(rawKey);
  if (!containerMatch) return { ...empty, parseStatus: 'invalid', field: null };
  const container = containerMatch[1];

  // The row-name segment can contain @, newlines, or game control syntax.
  // These are source-table locations, never verified dialogue sequence numbers.
  const nested = /^[^@\r\n]+\.json@(\d+)@([^@\r\n]*)@(table|text)@(\d+)@([\s\S]*)@([\w]+)$/.exec(
    rawKey,
  );
  if (nested && Number.isSafeInteger(Number(nested[4]))) {
    return {
      container,
      sceneCandidate: nested[2] || null,
      tablePosition: Number(nested[4]),
      parseStatus: 'parsed',
      field: nested[6],
    };
  }

  // Do not reinterpret a malformed nested key as a flat key.
  const flat = /^[^@\r\n]+\.json@(\d+)@([^\r\n]*)@([\w]+)$/.exec(rawKey);
  if (flat && !/@(?:table|text)@/.test(rawKey) && Number.isSafeInteger(Number(flat[1]))) {
    return {
      container,
      sceneCandidate: /speech_list_/i.test(container) ? container : null,
      tablePosition: Number(flat[1]),
      parseStatus: 'parsed',
      field: flat[3],
    };
  }
  return { ...empty, container, parseStatus: 'partial', field: null };
}

export function parseSourceKey(rawKey) {
  const { container, sceneCandidate, tablePosition, parseStatus } = inspectSourceKey(rawKey);
  return { container, sceneCandidate, tablePosition, parseStatus };
}

function isKnownColor(tag) {
  const match = /^<Color:(Default|\d+(?:,\d+){0,3})>$/.exec(tag);
  if (!match) return false;
  if (match[1] === 'Default') return true;
  const components = match[1].split(',').map(Number);
  return (
    [1, 3, 4].includes(components.length) && components.every((part) => part >= 0 && part <= 255)
  );
}

export function cleanKorean(text) {
  const raw = typeof text === 'string' ? text : '';
  const changes = [];
  const warnings = typeof text === 'string' ? [] : ['non_string_korean'];
  let clean = raw.normalize('NFC');
  if (clean !== raw) changes.push('unicode_nfc');
  const lf = clean.replace(/\r\n?/g, '\n');
  if (lf !== clean) changes.push('line_endings_lf');
  clean = lf.replace(/<[^<>\n]*>/g, (tag) => {
    if (isKnownColor(tag)) {
      changes.push('removed_color_controls');
      return '';
    }
    if (/^<Action:[A-Za-z][A-Za-z0-9_]*(?:@[A-Za-z][A-Za-z0-9_]*)?>$/.test(tag)) {
      changes.push('removed_action_controls');
      return '';
    }
    warnings.push('unrecognized_angle_tag');
    return tag;
  });
  if (/\$\{[^}]*\}/.test(clean)) warnings.push('unresolved_template_variable');
  if (clean.includes('\uFFFD')) warnings.push('replacement_character');
  // Preserve suspicious bytes for review instead of silently repairing source data.
  if (
    [...clean].some((char) => {
      const code = char.codePointAt(0);
      return (code < 32 && code !== 9 && code !== 10) || code === 127;
    })
  ) {
    warnings.push('unexpected_control_character');
  }
  return { raw, clean, changes: [...new Set(changes)], warnings: [...new Set(warnings)] };
}

export function findCharacterMentions(texts, characters = []) {
  const values = typeof texts === 'string' ? [texts] : Object.values(texts ?? {});
  const normalized = values
    .filter((value) => typeof value === 'string')
    .map((value) => value.normalize('NFC'));
  return characters.flatMap((character) => {
    if (!character || typeof character.id !== 'string' || !Array.isArray(character.aliases))
      return [];
    const aliases = character.aliases.filter((alias) => {
      if (typeof alias !== 'string' || !alias.trim()) return false;
      const name = alias.normalize('NFC');
      // These surnames are also ordinary English words. A full name or a
      // Japanese/Korean alias may match, but these standalone aliases may not.
      if (/^(?:mine|date)$/i.test(name.trim())) return false;
      if (/^[\p{Script=Latin}\p{M}\s.'’-]+$/u.test(name)) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'iu');
        return normalized.some((value) => pattern.test(value));
      }
      return normalized.some((value) => value.includes(name));
    });
    return aliases.length ? [{ id: character.id, aliases: [...new Set(aliases)] }] : [];
  });
}

function classify(locator, field) {
  const container = (locator.container ?? '').toLowerCase();
  const path = `${container}/${locator.sceneCandidate ?? ''}`.toLowerCase();
  if (/(?:^|[/_.-])mail(?:$|[/_.-])/.test(path)) {
    return { kind: 'mail_candidate', reason: 'source_path_mail' };
  }
  if (
    /(?:^|[/_.-])(?:enemyname[a-z]*|reactive_obj_name|reactor_name|streetname)(?:$|[/_.-])/.test(
      path,
    ) ||
    /\/(?:name|names)(?:$|\/)/.test(path) ||
    (container === 'talk_talker.bin.json' && field === 'talk_talker') ||
    field === 'name'
  ) {
    return { kind: 'name_candidate', reason: 'source_path_or_field_name' };
  }
  if (
    /\/auth\/event\//.test(path) ||
    /^sound_auth[^/]*\.bin\.json$/.test(container) ||
    container === 'auth.bin.json' ||
    container === 'talk.bin.json'
  ) {
    return { kind: 'dialogue_candidate', reason: 'source_path_dialogue' };
  }
  if (
    /(?:^|[/_.-])(?:minigame|common|item|mission|quest|ctrl_type|button)(?:$|[/_.-])/.test(path)
  ) {
    return { kind: 'ui_candidate', reason: 'source_path_ui' };
  }
  return { kind: 'unknown', reason: 'source_path_unclassified' };
}

export function normalizeRecord(
  row,
  { gameId, sourcePath, sourceRevision, lineNumber, characters = [] },
) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('Expected a JSON record object');
  }
  if (
    ![gameId, sourcePath, sourceRevision].every(
      (value) => typeof value === 'string' && value.length > 0,
    ) ||
    !Number.isSafeInteger(lineNumber) ||
    lineNumber < 1
  ) {
    throw new TypeError('Expected source game, path, revision, and a positive line number');
  }

  const languages = {};
  const metadataEntries = [];
  const holdReasons = ['speaker_unverified', 'recipient_unverified', 'order_unverified'];
  for (const [key, value] of Object.entries(row)) {
    const match = languageField.exec(key);
    if (match && typeof value === 'string') {
      languages[match[1]] = value;
    } else {
      metadataEntries.push([key, structuredClone(value)]);
      if (match) holdReasons.push(`non_string_language:${match[1]}`);
    }
  }

  let extension = null;
  try {
    extension = JSON.parse(row['扩展字段']);
    if (!extension || typeof extension !== 'object' || Array.isArray(extension)) {
      holdReasons.push('invalid_extension_object');
      extension = null;
    }
  } catch {
    holdReasons.push('invalid_extension_json');
  }
  const rawKey = typeof extension?.k === 'string' ? extension.k : null;
  const inspected = inspectSourceKey(rawKey);
  const locator = parseSourceKey(rawKey);
  const classification = classify(locator, inspected.field);
  const korean = cleanKorean(languages.ko ?? '');
  if (!korean.clean.trim()) holdReasons.push('missing_korean');
  if (locator.parseStatus !== 'parsed') holdReasons.push('source_key_unverified');
  if (classification.kind === 'ui_candidate' || classification.kind === 'name_candidate') {
    holdReasons.push('non_dialogue_candidate');
  } else if (classification.kind === 'unknown') {
    holdReasons.push('unclassified_source');
  }
  holdReasons.push(...korean.warnings.map((warning) => `korean:${warning}`));

  const id = hash(JSON.stringify([gameId, sourcePath, sourceRevision, lineNumber, rawKey]));
  return {
    id,
    source: {
      gameId,
      path: sourcePath,
      revision: sourceRevision,
      lineNumber,
      rawKey,
      rawRowHash: hash(JSON.stringify(row)),
    },
    languages,
    korean,
    locator,
    classification,
    review: {
      speaker: null,
      recipient: null,
      storyGame: null,
      timeline: null,
      orderStatus: 'unverified',
      trainingEligible: false,
      holdReasons: [...new Set(holdReasons)],
    },
    mentionedCharacters: findCharacterMentions(languages, characters),
    contentHash: hash(JSON.stringify([korean.clean, (languages.ja ?? '').normalize('NFC')])),
    sceneGroup: locator.sceneCandidate
      ? hash(
          JSON.stringify([
            gameId,
            sourcePath,
            sourceRevision,
            locator.container,
            locator.sceneCandidate,
          ]),
        )
      : `unresolved:${id}`,
    upstreamMetadata: Object.fromEntries(metadataEntries),
  };
}
