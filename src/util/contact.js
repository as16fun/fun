// Shared by the journey and the case studies: placeholders, and where "Contact" leads.

/** Text in [square brackets] is a placeholder still to fill in. */
export const isPlaceholder = (s) => /\[[^\]]+\]/.test(String(s ?? ''));

/** The email once it's filled in, otherwise the first real profile link (LinkedIn). */
export function contactTarget(person = {}) {
  if (person.email && !isPlaceholder(person.email)) return { href: `mailto:${person.email}`, external: false };
  const link = person.links?.find((l) => l.url && !isPlaceholder(l.url));
  return link ? { href: link.url, external: true } : null;
}

/** Link attributes for a contact target; external profiles open in a new tab. */
export const contactAttrs = (target, fallback = '#contact') =>
  target ? { href: target.href, ...(target.external ? { target: '_blank', rel: 'noopener' } : {}) } : { href: fallback };
