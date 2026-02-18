const BASE_URL = 'https://epitome.fyi';

interface SEOProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
}

/**
 * Per-page SEO using React 19 native metadata hoisting.
 * React 19 auto-hoists <title>, <meta>, and <link> to <head>.
 */
export default function SEO({ title, description, path = '', image }: SEOProps) {
  const url = `${BASE_URL}${path}`;
  const imageUrl = image ? `${BASE_URL}${image}` : `${BASE_URL}/og-image.png`;

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:image" content={imageUrl} />

      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
    </>
  );
}

/** JSON-LD structured data for the landing page. */
export function LandingJsonLd() {
  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Epitome',
      url: BASE_URL,
      description: 'Personal AI database and portable identity layer',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Epitome',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'Web, Docker, Linux, macOS',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      license: 'https://opensource.org/licenses/MIT',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Epitome',
      url: BASE_URL,
      logo: `${BASE_URL}/epitome.png`,
      sameAs: ['https://github.com/gunning4it/epitome'],
    },
  ];

  return (
    <>
      {schemas.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
