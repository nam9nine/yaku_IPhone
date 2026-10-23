import './home-indicator.css';

/** Visual handle only; the enclosing gesture surface owns pointer input. */
export function HomeIndicator() {
  return <span className="home-indicator" aria-hidden="true" />;
}
