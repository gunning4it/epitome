import LegalPage from '@/components/legal/LegalPage';

const headings = [
  { id: 'what-are-cookies', text: 'What Are Cookies', level: 2 },
  { id: 'cookies-we-use', text: 'Cookies We Use', level: 2 },
  { id: 'no-tracking-cookies', text: 'No Tracking Cookies', level: 2 },
  { id: 'managing-cookies', text: 'Managing Cookies', level: 2 },
  { id: 'changes', text: 'Changes to This Policy', level: 2 },
];

export default function CookiePolicy() {
  return (
    <LegalPage
      title="Cookie Policy"
      description="How Epitome uses cookies — spoiler: just one, for authentication."
      effectiveDate="February 18, 2026"
      headings={headings}
    >
      <h2 id="what-are-cookies">What Are Cookies</h2>
      <p>
        Cookies are small text files stored on your device by your web browser.
        They are widely used to make websites work efficiently and to provide
        information to site owners.
      </p>

      <h2 id="cookies-we-use">Cookies We Use</h2>
      <p>Epitome uses a single cookie:</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Purpose</th>
            <th>Type</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>epitome_session</code></td>
            <td>Maintains your authenticated session after signing in with Google</td>
            <td>Essential / Strictly Necessary</td>
            <td>30 days</td>
          </tr>
        </tbody>
      </table>
      <p>This cookie is:</p>
      <ul>
        <li><strong>HttpOnly</strong> — not accessible to JavaScript, protecting against XSS attacks</li>
        <li><strong>Secure</strong> — only transmitted over HTTPS connections</li>
        <li><strong>SameSite=Lax</strong> — provides CSRF protection while allowing normal navigation</li>
      </ul>

      <h2 id="no-tracking-cookies">No Tracking Cookies</h2>
      <p>Epitome does <strong>not</strong> use:</p>
      <ul>
        <li>Analytics cookies (no Google Analytics, Mixpanel, etc.)</li>
        <li>Advertising or retargeting cookies</li>
        <li>Third-party tracking cookies of any kind</li>
        <li>Social media tracking pixels</li>
      </ul>
      <p>
        We do not track your behavior across websites, build advertising
        profiles, or share browsing data with third parties.
      </p>

      <h2 id="managing-cookies">Managing Cookies</h2>
      <p>
        You can manage cookies through your browser settings. Most browsers allow
        you to block or delete cookies. However, if you disable the{' '}
        <code>epitome_session</code> cookie, you will not be able to sign in to
        the Epitome dashboard.
      </p>
      <p>
        Since we only use a single essential cookie for authentication, there is
        no cookie consent banner — essential cookies do not require consent under
        GDPR and ePrivacy regulations.
      </p>

      <h2 id="changes">Changes to This Policy</h2>
      <p>
        If we ever introduce additional cookies, we will update this policy and
        notify users through the dashboard. Any non-essential cookies would
        require your explicit consent before being set.
      </p>
      <p>
        Questions? Contact us at{' '}
        <a href="mailto:support@epitome.fyi">support@epitome.fyi</a>.
      </p>
    </LegalPage>
  );
}
