import { internalPages, searchPages, type SafariPage } from './pages';
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
        <section aria-label="둘러보기">
          <h3>둘러보기</h3>
          <div className="safari-quick-links">
            {internalPages.map((item) => (
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
        <section className="safari-start-card">
          <span className="safari-eyebrow">YAKU</span>
          <h3>
            익숙한 곳에서,
            <br />
            새로운 시작.
          </h3>
          <p>
            두 개의 작은 페이지를 둘러보세요.
            <br />
            아래 주소 막대에서 제목으로 찾을 수도 있어요.
          </p>
          <button
            tabIndex={0}
            className="safari-text-link"
            onClick={() => visit({ kind: 'internal', id: 'guide' })}
          >
            시작 안내 열기 <SafariIcon name="arrow" />
          </button>
        </section>
        <p className="safari-start-note">외부 웹 주소는 기기의 브라우저에서 열 수 있어요.</p>
      </div>
    );
  }
  if (page.kind === 'search') {
    const results = searchPages(page.query);
    return (
      <div className="safari-search-page">
        <span className="safari-eyebrow">이 앱의 페이지 검색</span>
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
            <p>‘시작 안내’ 또는 ‘예제 페이지’를 검색해 보세요.</p>
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
        <p>이 주소는 기기의 브라우저에서 열립니다.</p>
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
  if (page.id === 'guide') {
    return (
      <article className="safari-article safari-guide">
        <header className="safari-site-header">
          <span>yaku</span>
          <span>시작 안내</span>
        </header>
        <div className="safari-article-body">
          <span className="safari-eyebrow">HELLO, YAKU</span>
          <h2>
            작은 화면,
            <br />
            새로운 하루.
          </h2>
          <p className="safari-lead">
            손끝에 익숙한 동작으로
            <br />
            나만의 공간을 둘러보세요.
          </p>
          <div className="safari-guide-art" aria-hidden="true">
            <span />
            <span />
            <SafariIcon name="compass" />
          </div>
          <section>
            <span className="safari-step">01</span>
            <h3>어디서든 홈으로</h3>
            <p>
              화면 아래에서 위로 밀면 홈 화면으로 돌아가요. ‘홈으로’ 버튼으로도 같은 동작을 할 수
              있어요.
            </p>
          </section>
          <section>
            <span className="safari-step">02</span>
            <h3>취향에 맞게</h3>
            <p>
              설정에서 화면의 밝고 어두운 모드와 글자 크기를 바꿔보세요. 바꾼 모습은 앱을 오가도
              이어져요.
            </p>
          </section>
          <section>
            <span className="safari-step">03</span>
            <h3>탭으로 이어보기</h3>
            <p>
              새 탭을 열어 다른 페이지를 살펴보세요. 이전 탭으로 돌아오면 읽던 위치가 기다리고
              있어요.
            </p>
          </section>
          <button
            tabIndex={0}
            className="safari-primary-button"
            onClick={() => visit({ kind: 'internal', id: 'example' })}
          >
            예제 페이지 둘러보기 <SafariIcon name="arrow" />
          </button>
          <footer>YAKU · 이 앱 안에서 제공하는 예제 페이지</footer>
        </div>
      </article>
    );
  }
  return (
    <article className="safari-article safari-example">
      <header className="safari-site-header">
        <span>slow day</span>
        <span>예제 페이지</span>
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
          시작 안내로 돌아가기 <SafariIcon name="arrow" />
        </button>
        <footer>YAKU · 이 앱 안에서 제공하는 예제 페이지</footer>
      </div>
    </article>
  );
}
