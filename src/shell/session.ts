export type RunnableApp = 'settings' | 'safari';
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
}
export type ShellAction =
  { type: 'unlock' | 'lock' | 'home' } | { type: 'open'; app: RunnableApp; origin: LaunchRect };

export const initialShellState: ShellState = {
  locked: true,
  hasUnlocked: false,
  activeApp: null,
  visited: [],
  launcher: null,
  origin: null,
};

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'unlock':
      return { ...state, locked: false, hasUnlocked: true };
    case 'lock':
      return { ...state, locked: true, activeApp: null };
    case 'home':
      return state.activeApp ? { ...state, activeApp: null } : state;
    case 'open':
      if (state.locked || state.activeApp) return state;
      return {
        ...state,
        activeApp: action.app,
        launcher: action.app,
        origin: action.origin,
        visited: state.visited.includes(action.app)
          ? state.visited
          : [...state.visited, action.app],
      };
  }
}
