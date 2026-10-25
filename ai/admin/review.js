const $ = (selector) => document.querySelector(selector);
const names = { haruka: '하루카', majima: '마지마' };
const axisNames = {
  speech: ['말투', '호칭 · 어미 · 길이'],
  judgment: ['판단', '성격 · 목적 · 선택'],
  relationship: ['관계 · 감정', '거리감 · 장난 · 진지함'],
  knowledge: ['스토리 · 지식', '시점 · 허용된 원작 사실'],
  context: ['문맥 · 기억', '정정 · 취소 · 지시 대상'],
  format: ['문자 형식', '짧은 답장 · 지문 없음'],
};
const ratingNames = {
  unrated: '미평가',
  problem: '문제 있음',
  partial: '일부 아쉬움',
  appropriate: '적절함',
};
const state = {
  csrf: '',
  cases: [],
  selected: new Set(),
  current: null,
  detail: null,
  offset: 0,
  nextOffset: null,
  random: false,
  expanded: false,
  queueRevision: 0,
  detailRevision: 0,
  busy: false,
};

function el(tag, className = '', content = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = content;
  return node;
}

function status(message, error = false) {
  $('#status').textContent = message;
  $('#status').classList.toggle('error', error);
}

function enableReview(enabled) {
  $('#review-fields').disabled = !enabled;
  $('#save').disabled = !enabled;
  $('#save-next').disabled = !enabled;
}

async function api(path, { method = 'GET', body, blob = false } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && state.csrf ? { 'X-CSRF-Token': state.csrf } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || '검토 서버에 연결하지 못했습니다.');
  }
  return blob ? response.blob() : response.json();
}

function date(value, short = false) {
  if (!value || Number.isNaN(new Date(value).valueOf())) return '시각 미상';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    ...(short ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

function queryParams() {
  const form = new FormData($('#filters'));
  const params = new URLSearchParams();
  for (const [key, value] of form) {
    if (!value) continue;
    if (key === 'after' || key === 'before') {
      const instant = new Date(`${value}T00:00:00+09:00`);
      if (key === 'before') instant.setTime(instant.valueOf() + 86400000);
      params.set(key, instant.toISOString().replace('Z', '+00:00'));
    } else {
      params.set(key, value === 'on' ? 'true' : value);
    }
  }
  params.set('offset', String(state.offset));
  params.set('limit', '50');
  if (state.random) params.set('random_sample', 'true');
  return params;
}

function badge(item) {
  if (item.status === 'error' || item.status === 'interrupted') {
    return el(
      'span',
      'badge failure',
      item.error_code === 'response_truncated' || item.error_code === 'length' ? '잘림' : '실패',
    );
  }
  if ((item.metrics?.total_seconds || 0) > 20) return el('span', 'badge slow', '지연');
  return el(
    'span',
    `badge ${item.review_count ? 'reviewed' : ''}`,
    item.review_count ? '검토됨' : '미검토',
  );
}

function renderQueue() {
  const list = $('#case-list');
  list.replaceChildren();
  $('#queue-count').textContent = String(state.cases.length);
  $('#queue-order').textContent = state.random
    ? '무작위 표본 · 현재 필터 적용'
    : '실패 → 지연 → 미검토';
  for (const item of state.cases) {
    const row = el('div', `case-row ${item.job_id === state.current ? 'active' : ''}`);
    row.setAttribute('role', 'listitem');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = state.selected.has(item.job_id);
    check.setAttribute(
      'aria-label',
      `${names[item.character_id] || item.character_id} ${date(item.accepted_at)} 대화 내보내기 선택`,
    );
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(item.job_id);
      else state.selected.delete(item.job_id);
      renderExportCount();
    });
    const open = el('button', 'case-open');
    open.type = 'button';
    open.setAttribute('aria-current', item.job_id === state.current ? 'true' : 'false');
    open.addEventListener('click', () => selectCase(item.job_id));
    const top = el('div', 'case-top');
    top.append(el('span', 'case-name', names[item.character_id] || item.character_id), badge(item));
    const meta = el('div', 'case-meta');
    meta.append(
      el('span', '', `방문자 ${item.visitor_id.slice(0, 8)}`),
      el('span', '', date(item.accepted_at, true)),
    );
    open.append(top, el('p', 'case-preview', item.message || '(원문 없음)'), meta);
    row.append(check, open);
    list.append(row);
  }
  if (!state.cases.length) list.append(el('p', 'empty', '이 조건의 대화가 없습니다.'));
  $('#previous-page').disabled = state.offset === 0 || state.random;
  $('#next-page').disabled = state.nextOffset === null || state.random;
  updateNavigation();
}

function renderExportCount() {
  $('#selected-count').textContent = String(state.selected.size);
  $('#export').disabled = !state.selected.size;
}

async function loadQueue(preferredId = state.current) {
  const revision = ++state.queueRevision;
  status('검토할 대화를 불러오고 있습니다.');
  try {
    const result = await api(`/v1/admin/queue?${queryParams()}`);
    if (revision !== state.queueRevision) return;
    state.cases = result.cases;
    state.nextOffset = result.next_offset;
    renderQueue();
    const preferred = state.cases.find((item) => item.job_id === preferredId);
    const first = preferred || state.cases[0];
    if (first) await selectCase(first.job_id);
    else clearSelection();
    status(`현재 목록 ${state.cases.length}개 · 원문과 검토는 별도로 보존됩니다.`);
  } catch (error) {
    status(error.message, true);
  }
}

function clearSelection() {
  state.current = null;
  state.detail = null;
  ++state.detailRevision;
  $('#conversation-title').textContent = '대화를 선택해 주세요';
  $('#conversation-meta').textContent = '';
  $('#case-state').replaceChildren();
  $('#conversation').replaceChildren(el('p', 'empty', '현재 필터에 해당하는 대화가 없습니다.'));
  enableReview(false);
  $('#expand-conversation').disabled = true;
  $('#review-count').textContent = '미선택';
  $('#metrics').replaceChildren();
  $('#evidence').replaceChildren();
  $('#past-reviews').hidden = true;
  updateNavigation();
}

async function selectCase(identifier) {
  const revision = ++state.detailRevision;
  state.current = identifier;
  state.expanded = false;
  enableReview(false);
  renderQueue();
  try {
    const detail = await api(`/v1/admin/cases/${encodeURIComponent(identifier)}`);
    if (revision !== state.detailRevision) return;
    state.detail = detail;
    $('#conversation-title').textContent = `${names[detail.character] || detail.character}와 키류`;
    $('#conversation-meta').textContent =
      `방문자 ${detail.visitor_id} · ${detail.scenario_version}`;
    $('#case-state').replaceChildren(
      badge({ ...detail, metrics: detail.run?.metrics, review_count: detail.reviews.length }),
    );
    $('#expand-conversation').disabled = false;
    renderConversation();
    renderReview();
    renderEvidence();
    updateNavigation();
  } catch (error) {
    status(error.message, true);
  }
}

function appendMessage(container, message, { failed = false } = {}) {
  const selected = message.job_id === state.current;
  const row = el(
    'article',
    `message-row ${message.role} ${selected ? 'selected' : ''} ${failed ? 'failed' : ''}`,
  );
  if (selected && message.role === 'assistant')
    row.append(
      el('span', 'selected-label', failed ? '검토할 실패 출력 · 정상 이력 제외' : '검토할 답장'),
    );
  row.append(
    el(
      'p',
      'message-label',
      message.role === 'user'
        ? '키류 · 방문자 입력'
        : names[state.detail.character] || state.detail.character,
    ),
  );
  row.append(el('p', 'message-bubble', message.content));
  row.append(
    el(
      'p',
      'message-time',
      `${date(message.time)}${message.model_eligible === false && message.role === 'user' ? ' · 정상 교환 미완료' : ''}`,
    ),
  );
  container.append(row);
}

function renderConversation() {
  const container = $('#conversation');
  container.replaceChildren();
  const detail = state.detail;
  if (!detail) return;
  const all = detail.messages;
  const index = Math.max(
    0,
    all.findIndex((message) => message.job_id === state.current),
  );
  const visible = state.expanded ? all : all.slice(Math.max(0, index - 4), index + 6);
  container.append(
    el(
      'p',
      'context-notice',
      state.expanded
        ? `전체 원문 ${all.length}개`
        : `원문 ${all.length}개 중 선택한 답장 앞뒤 문맥`,
    ),
  );
  for (const message of visible) {
    appendMessage(container, message);
    if (message.job_id === state.current && message.role === 'user' && detail.status === 'error') {
      appendMessage(
        container,
        {
          role: 'assistant',
          job_id: state.current,
          content: detail.run?.output_text || '확보된 실패 출력이 없습니다.',
          time: detail.run?.completed_at,
        },
        { failed: true },
      );
    }
  }
  $('#expand-conversation').textContent = state.expanded
    ? '앞뒤 문맥만 보기'
    : `전체 대화 보기 (${all.length})`;
  container.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

function buildReviewForm(config) {
  for (const axis of config.axes) {
    const [name, description] = axisNames[axis];
    const label = el('label', 'axis-row');
    const title = el('span', 'axis-label', name);
    title.append(el('small', '', description));
    const select = el('select');
    select.name = axis;
    select.id = `axis-${axis}`;
    for (const [value, text] of Object.entries(ratingNames)) {
      const option = el('option', '', text);
      option.value = value;
      select.append(option);
    }
    label.append(title, select);
    $('#axes').append(label);
  }
  for (const tag of config.tags) {
    const label = el('label', 'tag-label');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.value = tag;
    checkbox.name = 'tag';
    label.append(checkbox, document.createTextNode(tag));
    $('#tags').append(label);
  }
}

function renderReview() {
  const reviews = state.detail.reviews;
  const current = reviews.at(-1);
  for (const axis of Object.keys(axisNames))
    $(`#axis-${axis}`).value = current?.axes[axis] || 'unrated';
  for (const checkbox of document.querySelectorAll('#tags input'))
    checkbox.checked = current?.tags.includes(checkbox.value) || false;
  $('#cause').value = current?.cause || 'unknown';
  $('#note').value = current?.note || '';
  $('#improved-answer').value = current?.improved_answer || '';
  $('#review-count').textContent = reviews.length ? `검토 ${reviews.length}회` : '미검토';
  enableReview(true);
  $('#past-reviews').hidden = !reviews.length;
  $('#review-history').replaceChildren();
  for (const item of [...reviews].reverse()) {
    const entry = el('div', 'review-entry');
    entry.append(el('strong', '', `${date(item.created_at)} · ${item.reviewer}`));
    entry.append(
      el(
        'p',
        '',
        Object.entries(item.axes)
          .map(
            ([axis, rating]) => `${axisNames[axis]?.[0] || axis}: ${ratingNames[rating] || rating}`,
          )
          .join(' / '),
      ),
    );
    if (item.note) entry.append(el('p', '', item.note));
    if (item.improved_answer) entry.append(el('p', '', `개선 답안: ${item.improved_answer}`));
    $('#review-history').append(entry);
  }
}

function evidenceBlock(title, data, open = false) {
  const details = el('details');
  details.open = open;
  details.append(
    el('summary', '', title),
    el('pre', '', typeof data === 'string' ? data : JSON.stringify(data, null, 2)),
  );
  return details;
}

function renderEvidence() {
  const run = state.detail.run;
  $('#metrics').replaceChildren();
  for (const [label, value] of [
    ['완료 시간', run?.metrics?.total_seconds],
    ['첫 토큰', run?.metrics?.ttft_seconds],
    ['대기 시간', run?.metrics?.queue_seconds],
  ]) {
    const metric = el('div', 'metric');
    metric.append(
      el('strong', '', typeof value === 'number' ? `${value.toFixed(2)}s` : '미기록'),
      el('span', '', label),
    );
    $('#metrics').append(metric);
  }
  const evidence = $('#evidence');
  evidence.replaceChildren();
  if (!run)
    evidence.append(
      el('p', 'muted', '이관한 기존 기록에는 실행 버전·입력 근거가 남아 있지 않습니다.'),
    );
  else {
    evidence.append(evidenceBlock('모델 · 프롬프트 · 실제 입력 구성', run.metadata));
    evidence.append(
      evidenceBlock('측정값 · 입력 해시 · 종료 조건', {
        ...run.metrics,
        input_sha256: run.input_sha256,
        finish_reason: run.finish_reason,
        error_code: run.error_code,
        started_at: run.started_at,
        completed_at: run.completed_at,
      }),
    );
  }
  for (const hit of state.detail.retrieval_hits)
    evidence.append(
      evidenceBlock(
        `${hit.kind === 'memory' ? '과거 대화' : hit.kind === 'scene' ? '참고 장면' : '원작 근거'} · ${hit.id || hit.source_id || 'ID 미기록'}`,
        hit,
      ),
    );
  if (!state.detail.retrieval_hits.length)
    evidence.append(el('p', 'muted', '이 요청에 저장된 검색 근거가 없습니다.'));
}

function nextUnreviewed(direction) {
  const index = state.cases.findIndex((item) => item.job_id === state.current);
  if (index < 0) return null;
  const candidates =
    direction > 0 ? state.cases.slice(index + 1) : state.cases.slice(0, index).reverse();
  return candidates.find((item) => !item.review_count)?.job_id || null;
}

function updateNavigation() {
  $('#previous-case').disabled = state.busy || !nextUnreviewed(-1);
  $('#next-case').disabled = state.busy || !nextUnreviewed(1);
}

async function saveReview(event) {
  event.preventDefault();
  if (!state.current || state.busy) return;
  const identifier = state.current;
  const next = event.submitter?.id === 'save-next' ? nextUnreviewed(1) : null;
  const data = {
    axes: Object.fromEntries(
      Object.keys(axisNames).map((axis) => [axis, $(`#axis-${axis}`).value]),
    ),
    tags: [...document.querySelectorAll('#tags input:checked')].map((input) => input.value),
    cause: $('#cause').value,
    note: $('#note').value,
    improved_answer: $('#improved-answer').value,
  };
  state.busy = true;
  enableReview(false);
  updateNavigation();
  try {
    await api(`/v1/admin/cases/${encodeURIComponent(identifier)}/reviews`, {
      method: 'POST',
      body: data,
    });
    await loadQueue(next || identifier);
    status('평가를 저장했습니다. 원문과 학습 승인 상태는 바뀌지 않았습니다.');
  } catch (error) {
    status(error.message, true);
  } finally {
    state.busy = false;
    enableReview(Boolean(state.detail));
    updateNavigation();
  }
}

async function showStats() {
  try {
    const result = await api(`/v1/admin/stats?${queryParams()}`);
    $('#stats-description').textContent =
      `현재 필터 · ${result.denominator} 각 비율은 “문제 있음 / 평가된 표본”이며 일부 아쉬움은 별도 표시합니다.`;
    const table = el('table', 'stats-table');
    const head = el('thead');
    const labels = [
      '날짜 · 모델 · 프롬프트',
      '전체 / 검토',
      '실패 / 지연',
      ...Object.values(axisNames).map(([name]) => name),
    ];
    const row = el('tr');
    for (const label of labels) row.append(el('th', '', label));
    head.append(row);
    table.append(head);
    const body = el('tbody');
    for (const group of result.groups) {
      const line = el('tr');
      line.append(
        el('td', 'version', `${group.day} · ${group.model} · ${group.prompt}`),
        el('td', '', `${group.total} / ${group.reviewed}`),
        el('td', '', `${group.failed} / ${group.slow}`),
      );
      for (const axis of Object.keys(axisNames)) {
        const item = group.axes[axis];
        line.append(
          el(
            'td',
            '',
            item.rated
              ? `${Math.round((item.problem / item.rated) * 100)}% (${item.problem}/${item.rated}) · 아쉬움 ${item.partial}`
              : '미평가',
          ),
        );
      }
      body.append(line);
    }
    table.append(body);
    $('#stats-content').replaceChildren(
      result.groups.length ? table : el('p', 'empty', '이 조건의 표본이 없습니다.'),
    );
    $('#stats-dialog').showModal();
  } catch (error) {
    status(error.message, true);
  }
}

async function exportSelected() {
  try {
    const blob = await api('/v1/admin/export', {
      method: 'POST',
      body: { job_ids: [...state.selected] },
      blob: true,
    });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = 'kiryu-review.jsonl';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`${state.selected.size}개 사례를 학습 미승인 JSONL로 내보냈습니다.`);
  } catch (error) {
    status(error.message, true);
  }
}

$('#filters').addEventListener('submit', (event) => {
  event.preventDefault();
  state.offset = 0;
  state.random = false;
  loadQueue();
});
$('#sample').addEventListener('click', () => {
  state.offset = 0;
  state.random = true;
  loadQueue(null);
});
$('#previous-page').addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - 50);
  loadQueue(null);
});
$('#next-page').addEventListener('click', () => {
  if (state.nextOffset !== null) {
    state.offset = state.nextOffset;
    loadQueue(null);
  }
});
$('#previous-case').addEventListener('click', () => {
  const next = nextUnreviewed(-1);
  if (next) selectCase(next);
});
$('#next-case').addEventListener('click', () => {
  const next = nextUnreviewed(1);
  if (next) selectCase(next);
});
$('#expand-conversation').addEventListener('click', () => {
  state.expanded = !state.expanded;
  renderConversation();
});
$('#review-form').addEventListener('submit', saveReview);
$('#export').addEventListener('click', exportSelected);
$('#show-stats').addEventListener('click', showStats);
$('#close-stats').addEventListener('click', () => $('#stats-dialog').close());
$('#logout').addEventListener('click', async () => {
  try {
    await api('/v1/admin/logout', { method: 'POST' });
    location.reload();
  } catch (error) {
    status(error.message, true);
  }
});

async function initialize() {
  try {
    const token = new URLSearchParams(location.hash.slice(1)).get('owner');
    if (location.hash) history.replaceState(null, '', location.pathname);
    if (token) await api('/v1/admin/session', { method: 'POST', body: { token } });
    const config = await api('/v1/admin/session');
    state.csrf = config.csrf;
    buildReviewForm(config);
    $('#workspace').hidden = false;
    $('#logout').hidden = false;
    await loadQueue(null);
  } catch (error) {
    $('#locked').hidden = false;
    status(error.message, true);
  }
}

initialize();
