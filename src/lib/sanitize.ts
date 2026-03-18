import DOMPurify from 'dompurify';

export const sanitizeContent = (content: string) => {
  return DOMPurify.sanitize(content, {
    ALLOWED_TAGS: [], // No tags allowed for basic chat/posts
    ALLOWED_ATTR: [],
  });
};
