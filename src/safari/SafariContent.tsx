import { internalPages, savedArticles, savedSearches, searchPages, type SafariPage } from './pages';
import { SafariIcon } from './SafariIcon';

export function SafariContent({
  page,
  visit,
  openExternal,
}: {
  page: SafariPage;
  visit: (page: SafariPage) => void;
  openExternal: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  if (page.kind === 'start') {
    return (
      <div className="safari-start">
        <div className="safari-start-heading">
          <SafariIcon name="compass" />
          <h2>시작 페이지</h2>
        </div>
        <section className="safari-saved-history" aria-label="저장된 검색 기록">
          <h3>최근 검색</h3>
          <ul>
            {savedSearches.map((item) => (
              <li key={item.pageId}>
                <button onClick={() => visit({ kind: 'search', query: item.query })}>
                  <SafariIcon name="search" />
                  <span>{item.query}</span>
                  <SafariIcon name="arrow" />
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section aria-label="둘러보기">
          <h3>저장된 페이지</h3>
          <div className="safari-quick-links">
            {internalPages
              .filter((item) => item.id === 'guide' || item.id === 'example')
              .map((item) => (
                <button
                  tabIndex={0}
                  key={item.id}
                  onClick={() => visit({ kind: 'internal', id: item.id })}
                >
                  <span className={`safari-site-tile safari-site-tile-${item.id}`}>
                    <SafariIcon name={item.id === 'guide' ? 'compass' : 'globe'} />
                  </span>
                  <span>{item.title}</span>
                </button>
              ))}
          </div>
        </section>
      </div>
    );
  }
  if (page.kind === 'search') {
    const results = searchPages(page.query);
    return (
      <div className="safari-search-page">
        <span className="safari-eyebrow">저장된 페이지 검색</span>
        <h2>{page.query}</h2>
        <p className="safari-secondary">검색 결과 {results.length}개</p>
        {results.length ? (
          <ul className="safari-search-results">
            {results.map((item) => (
              <li key={item.id}>
                <button tabIndex={0} onClick={() => visit({ kind: 'internal', id: item.id })}>
                  <span className="safari-search-url">{item.url}</span>
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="safari-empty">
            <SafariIcon name="search" />
            <h3>일치하는 페이지가 없어요</h3>
          </div>
        )}
        <button tabIndex={0} className="safari-text-link" onClick={() => visit({ kind: 'start' })}>
          시작 페이지로
        </button>
      </div>
    );
  }
  if (page.kind === 'external') {
    return (
      <div className="safari-external">
        <span className="safari-external-icon">
          <SafariIcon name="globe" />
        </span>
        <h2>외부 웹사이트</h2>
        <p className="safari-external-url">{page.url}</p>
        <a
          tabIndex={0}
          className="safari-primary-button"
          href={page.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={openExternal}
        >
          외부 브라우저에서 열기 <SafariIcon name="arrow" />
        </a>
        <p className="safari-secondary">새 탭 또는 새 창에서 열립니다.</p>
      </div>
    );
  }
  if (page.id in savedArticles) {
    const article = savedArticles[page.id as keyof typeof savedArticles];
    return (
      <article className="safari-article safari-saved-article">
        <header className="safari-site-header">
          <span>생활의 메모</span>
          <span>저장한 페이지</span>
        </header>
        <div className="safari-article-body">
          <h2>{article.title}</h2>
          <p className="safari-lead">{article.intro}</p>
          {article.sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </section>
          ))}
          <button className="safari-text-link" onClick={() => visit({ kind: 'start' })}>
            검색 기록으로 돌아가기 <SafariIcon name="arrow" />
          </button>
        </div>
      </article>
    );
  }
  if (page.id === 'guide') {
    return (
      <article className="safari-article safari-guide">
        <header className="safari-site-header">
          <span>하루카</span>
          <span>메모</span>
        </header>
        <div className="safari-article-body">
          <span className="safari-eyebrow">아저씨께</span>
          <h2>하루카의 메모</h2>
          <div className="safari-guide-art" aria-hidden="true">
            <span />
            <span />
            <SafariIcon name="compass" />
          </div>
          <button
            tabIndex={0}
            className="safari-primary-button"
            onClick={() => visit({ kind: 'internal', id: 'example' })}
          >
            주말 산책 읽기 <SafariIcon name="arrow" />
          </button>
        </div>
      </article>
    );
  }
  return (
    <article className="safari-article safari-example">
      <header className="safari-site-header">
        <span>slow day</span>
        <span>주말 산책</span>
      </header>
      <div className="safari-example-art" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="safari-article-body">
        <span className="safari-eyebrow">A LITTLE PAUSE</span>
        <h2>
          천천히,
          <br />
          나의 속도로.
        </h2>
        <p className="safari-lead">
          바쁜 하루 사이에 놓아두는
          <br />세 가지 작은 여유.
        </p>
        <section>
          <span className="safari-step">01</span>
          <h3>창가에 앉기</h3>
          <p>잠깐 고개를 들고 먼 풍경을 바라보세요. 빛이 머무는 자리를 천천히 따라가 보세요.</p>
        </section>
        <section>
          <span className="safari-step">02</span>
          <h3>한 문장 남기기</h3>
          <p>오늘 기억하고 싶은 순간을 골라보세요. 짧은 한 문장만으로도 충분한 기록이 됩니다.</p>
        </section>
        <section>
          <span className="safari-step">03</span>
          <h3>가볍게 걷기</h3>
          <p>늘 가던 길에서 조금 다른 풍경을 찾아보세요. 익숙한 하루에도 새로운 장면이 있어요.</p>
        </section>
        <button
          tabIndex={0}
          className="safari-text-link"
          onClick={() => visit({ kind: 'internal', id: 'guide' })}
        >
          메모으로 돌아가기 <SafariIcon name="arrow" />
        </button>
      </div>
    </article>
  );
}
