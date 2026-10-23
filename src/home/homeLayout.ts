import { homePages, type HomeApp } from './apps';
export interface HomePageLayout {
  widgets: boolean;
  apps: readonly HomeApp[];
}
export function homeLayout(
  height: number,
  rowHeight: number,
  widgetHeight: number,
): HomePageLayout[] {
  if (height <= 0 || rowHeight <= 0)
    return homePages.map((apps, index) => ({ widgets: index === 0, apps }));
  const rows = Math.max(1, Math.floor((height + 10) / (rowHeight + 10)));
  const widgets = widgetHeight > 0 && widgetHeight <= height;
  const firstRows = widgets
    ? Math.max(0, Math.floor((height - widgetHeight - 14 + 10) / (rowHeight + 10)))
    : rows;
  const result: HomePageLayout[] = [];
  for (const [index, group] of homePages.entries()) {
    let offset = 0;
    if (index === 0 && widgets) {
      const take = Math.min(group.length, firstRows * 4);
      result.push({ widgets: true, apps: group.slice(0, take) });
      offset = take;
    }
    while (offset < group.length) {
      result.push({ widgets: false, apps: group.slice(offset, offset + rows * 4) });
      offset += rows * 4;
    }
  }
  return result;
}
