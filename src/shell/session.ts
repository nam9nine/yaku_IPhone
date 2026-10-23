export type RunnableApp = 'settings' | 'safari';
export type SystemPanel = 'control' | 'switcher' | 'notifications' | 'search';
export interface LaunchRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ShellState {
  locked: boolean;
  hasUnlocked: boolean;
  activeApp: RunnableApp | null;
  visited: RunnableApp[];
  launcher: RunnableApp | null;
  origin: LaunchRect | null;
  panel: SystemPanel | null;
  switchOrder: RunnableApp[] | null;
}
export type ShellAction =
  | { type: 'unlock' | 'lock' | 'home' | 'dismiss-panel' }
  | { type: 'open'; app: RunnableApp; origin: LaunchRect | null }
  | { type: 'panel'; panel: SystemPanel }
  | { type: 'close-app'; app: RunnableApp }
  | { type: 'quick-switch'; direction: 'previous' | 'next' };
export const initialShellState: ShellState = {
  locked: true,
  hasUnlocked: false,
  activeApp: null,
  visited: [],
  launcher: null,
  origin: null,
  panel: null,
  switchOrder: null,
};
export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'unlock':
      return { ...state, locked: false, hasUnlocked: true, panel: null };
    case 'lock':
      return { ...state, locked: true, activeApp: null, panel: null, switchOrder: null };
    case 'home':
      return { ...state, activeApp: null, panel: null, switchOrder: null };
    case 'dismiss-panel':
      return { ...state, panel: null };
    case 'panel':
      if (state.locked && (action.panel === 'switcher' || action.panel === 'search')) return state;
      return { ...state, panel: action.panel, switchOrder: null };
    case 'open':
      if (state.locked || (state.activeApp === action.app && !state.panel)) return state;
      return {
        ...state,
        activeApp: action.app,
        launcher: action.app,
        origin: action.origin,
        panel: null,
        switchOrder: null,
        visited: [action.app, ...state.visited.filter((app) => app !== action.app)],
      };
    case 'close-app':
      return {
        ...state,
        visited: state.visited.filter((app) => app !== action.app),
        activeApp: state.activeApp === action.app ? null : state.activeApp,
        switchOrder: null,
      };
    case 'quick-switch': {
      if (state.locked || state.panel || !state.visited.length) return state;
      const order = state.switchOrder ?? state.visited;
      const index = state.activeApp ? order.indexOf(state.activeApp) : -1;
      const target = index + (action.direction === 'previous' ? 1 : -1);
      const app = order[target];
      if (!app) return state;
      return {
        ...state,
        activeApp: app,
        launcher: app,
        origin: null,
        switchOrder: order,
        visited: [app, ...state.visited.filter((candidate) => candidate !== app)],
      };
    }
  }
}
