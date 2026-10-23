export interface ExtraContact {
  id: string;
  name: string;
  phone: string;
}
export function validExtraContacts(value: unknown): value is ExtraContact[] {
  return (
    Array.isArray(value) &&
    value.length <= 100 &&
    value.every(
      (item) =>
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        /^local-[a-z0-9-]+$/.test(item.id) &&
        typeof item.name === 'string' &&
        item.name.length > 0 &&
        item.name.length <= 80 &&
        typeof item.phone === 'string' &&
        item.phone.length <= 40,
    ) &&
    new Set(value.map((item) => item.id)).size === value.length
  );
}
