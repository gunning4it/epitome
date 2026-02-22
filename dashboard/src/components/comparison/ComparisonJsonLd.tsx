const BASE_URL = 'https://epitome.fyi';

interface ComparisonJsonLdProps {
  variant: 'hub' | 'individual';
  path: string;
  title: string;
  description: string;
  competitors?: string[];
}

export default function ComparisonJsonLd({
  variant,
  path,
  title,
  description,
  competitors,
}: ComparisonJsonLdProps) {
  const url = `${BASE_URL}${path}`;

  const schemas =
    variant === 'hub'
      ? [
          {
            '@context': 'https://schema.org',
            '@type': 'CollectionPage',
            name: title,
            description,
            url,
            mainEntity: {
              '@type': 'SoftwareApplication',
              name: 'Epitome',
              applicationCategory: 'DeveloperApplication',
              operatingSystem: 'Web, Docker, Linux, macOS',
              offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            },
          },
        ]
      : [
          {
            '@context': 'https://schema.org',
            '@type': 'WebPage',
            name: title,
            description,
            url,
            about: [
              {
                '@type': 'SoftwareApplication',
                name: 'Epitome',
                applicationCategory: 'DeveloperApplication',
                url: BASE_URL,
              },
              ...(competitors ?? []).map((name) => ({
                '@type': 'SoftwareApplication',
                name,
                applicationCategory: 'DeveloperApplication',
              })),
            ],
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
