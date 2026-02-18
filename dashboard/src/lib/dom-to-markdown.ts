interface Options {
  title: string;
  description: string;
  sourceUrl: string;
}

/**
 * Converts a DOM element's content to clean LLM-friendly markdown.
 */
export function domToMarkdown(element: HTMLElement, options: Options): string {
  const lines: string[] = [];

  lines.push(`# ${options.title}`);
  lines.push('');
  lines.push(options.description);
  lines.push('');
  lines.push(`Source: ${options.sourceUrl}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  processNode(element, lines);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function processNode(node: Node, lines: string[]) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) lines.push(text);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // Skip decorative elements
    if (
      tag === 'svg' ||
      tag === 'button' ||
      el.getAttribute('aria-hidden') === 'true' ||
      el.classList.contains('doc-pagination')
    ) {
      continue;
    }

    switch (tag) {
      case 'h1':
        lines.push('');
        lines.push(`# ${getTextContent(el)}`);
        lines.push('');
        break;
      case 'h2':
        lines.push('');
        lines.push(`## ${getTextContent(el)}`);
        lines.push('');
        break;
      case 'h3':
        lines.push('');
        lines.push(`### ${getTextContent(el)}`);
        lines.push('');
        break;
      case 'h4':
        lines.push('');
        lines.push(`#### ${getTextContent(el)}`);
        lines.push('');
        break;
      case 'p':
        lines.push(getInlineContent(el));
        lines.push('');
        break;
      case 'pre': {
        const codeEl = el.querySelector('code');
        const code = codeEl?.textContent ?? el.textContent ?? '';
        const lang = detectLanguage(el);
        lines.push('');
        lines.push('```' + lang);
        lines.push(code.trim());
        lines.push('```');
        lines.push('');
        break;
      }
      case 'ul':
        lines.push('');
        processListItems(el, lines, '-');
        lines.push('');
        break;
      case 'ol':
        lines.push('');
        processListItems(el, lines, '1.');
        lines.push('');
        break;
      case 'code':
        lines.push(`\`${getTextContent(el)}\``);
        break;
      case 'a': {
        const href = el.getAttribute('href') ?? '';
        lines.push(`[${getTextContent(el)}](${href})`);
        break;
      }
      case 'strong':
      case 'b':
        lines.push(`**${getTextContent(el)}**`);
        break;
      case 'em':
      case 'i':
        lines.push(`*${getTextContent(el)}*`);
        break;
      case 'br':
        lines.push('');
        break;
      default:
        // Recurse into divs, sections, articles, etc.
        processNode(el, lines);
        break;
    }
  }
}

function processListItems(list: HTMLElement, lines: string[], marker: string) {
  const items = list.querySelectorAll(':scope > li');
  items.forEach((item, i) => {
    const prefix = marker === '1.' ? `${i + 1}.` : marker;
    lines.push(`${prefix} ${getInlineContent(item as HTMLElement)}`);
  });
}

function getTextContent(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function getInlineContent(el: HTMLElement): string {
  let result = '';
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent ?? '';
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const childEl = child as HTMLElement;
    const tag = childEl.tagName.toLowerCase();

    switch (tag) {
      case 'strong':
      case 'b':
        result += `**${getTextContent(childEl)}**`;
        break;
      case 'em':
      case 'i':
        result += `*${getTextContent(childEl)}*`;
        break;
      case 'code':
        result += `\`${getTextContent(childEl)}\``;
        break;
      case 'a': {
        const href = childEl.getAttribute('href') ?? '';
        result += `[${getTextContent(childEl)}](${href})`;
        break;
      }
      default:
        result += getTextContent(childEl);
        break;
    }
  }
  return result.replace(/\s+/g, ' ').trim();
}

function detectLanguage(preEl: HTMLElement): string {
  // Check parent wrapper for language label (CodeBlock pattern)
  const wrapper = preEl.closest('[class*="rounded-lg"]');
  if (wrapper) {
    const langLabel = wrapper.querySelector('[class*="border-b"]');
    if (langLabel?.textContent) return langLabel.textContent.trim();
  }

  // Check code element class
  const codeEl = preEl.querySelector('code');
  if (codeEl) {
    const cls = codeEl.className;
    const match = cls.match(/language-(\w+)/);
    if (match) return match[1];
  }

  return '';
}
