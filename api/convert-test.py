#!/usr/bin/env python3
"""
Convert Supertest patterns to Hono app.request() patterns
"""
import re
import sys

def convert_test_file(content):
    # Remove supertest import
    content = re.sub(r"import request from 'supertest';\n", '', content)

    # Convert GET requests
    # Pattern: await request(app.fetch as any).get('/path').set(headers)
    # To: await app.request('/path', { method: 'GET', headers })
    content = re.sub(
        r'await request\(app\.fetch as any\)\s*\.get\(([^\)]+)\)\s*\.set\(([^\)]+)\);',
        r'await app.request(\1, { method: "GET", headers: \2 });',
        content
    )

    # Convert GET requests without .set()
    content = re.sub(
        r'await request\(app\.fetch as any\)\.get\(([^\)]+)\);',
        r'await app.request(\1, { method: "GET" });',
        content
    )

    # Convert POST requests with .set() and .send()
    # Pattern: await request(app.fetch as any).post('/path').set(headers).send(data)
    # To: await app.request('/path', { method: 'POST', headers, body: JSON.stringify(data) })
    content = re.sub(
        r'await request\(app\.fetch as any\)\s*\.post\(([^\)]+)\)\s*\.set\(([^\)]+)\)\s*\.send\(([^\)]+)\);',
        r'await app.request(\1, { method: "POST", headers: \2, body: JSON.stringify(\3) });',
        content
    )

    # Convert response.body to await response.json()
    # First pass: store response in variable and call .json()
    # This is tricky - we need to handle it differently

    return content

if __name__ == '__main__':
    with open('/Users/brucewayne/epitome/api/tests/integration/api/graph.test.ts.backup', 'r') as f:
        content = f.read()

    converted = convert_test_file(content)

    with open('/Users/brucewayne/epitome/api/tests/integration/api/graph.test.ts', 'w') as f:
        f.write(converted)

    print("Conversion complete!")
