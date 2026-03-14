// A simple keyword filter for demonstration. 
// In a real-world app, this would be an external API or a much more extensive list.
const BANNED_KEYWORDS = [
  'slut', 'whore', 'faggot', 'nigger', 'kike', 'chink', 'spic', 'cunt',
  'retard', 'tranny', 'dyke', 'rape', 'pedophile', 'hitler', 'nazi'
];

export function containsInappropriateContent(text: string): { matches: boolean; word?: string } {
  const normalized = text.toLowerCase();
  for (const word of BANNED_KEYWORDS) {
    if (normalized.includes(word)) {
      return { matches: true, word };
    }
  }
  return { matches: false };
}

export function redactContent(text: string): string {
  let redacted = text;
  for (const word of BANNED_KEYWORDS) {
    const regex = new RegExp(word, 'gi');
    redacted = redacted.replace(regex, '***');
  }
  return redacted;
}
