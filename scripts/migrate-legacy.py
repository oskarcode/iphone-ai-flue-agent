#!/usr/bin/env python3
"""Inventory this Worker's legacy DOs and import retained visible histories.
Requires existing Wrangler OAuth and a cached, valid cloudflared Access JWT.
Never prints credentials or conversation content. No model calls or GitHub writes.
"""
import argparse
import json
import pathlib
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request

ACCOUNT = 'f2b0debf4bd2bf50f7d1a81d1ab88946'
WORKER = 'iphone-ai-flue-agent'
ORIGIN = 'https://iphoneai.oskarcode.com'


def main():
    """Input: CLI inventory/apply/report flags.
    Output: a local ID/count report and exit status.
    What this function does: inventories legacy storage; writes imports only with --apply.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true', help='Import after inventory; default is read-only inventory')
    parser.add_argument('--report', default='/tmp/pi-learning-migration-report.json')
    args = parser.parse_args()
    config = pathlib.Path.home() / 'Library/Preferences/.wrangler/config/default.toml'
    oauth = tomllib.loads(config.read_text())['oauth_token']
    jwt = None
    if args.apply:
        candidates = list((pathlib.Path.home() / '.cloudflared').glob('iphoneai.oskarcode.com-*-token'))
        if len(candidates) != 1:
            raise SystemExit('Expected one cached Access token for this domain. Authenticate with cloudflared first.')
        jwt = candidates[0].read_text().strip()

    def request(url, body=None, control=False):
        """Input: API URL, optional JSON and control-plane choice.
        Output: decoded response or HTTP/network exception.
        What this function does: selects the existing credential boundary without printing tokens.
        """
        headers = {'User-Agent': 'Mozilla/5.0', 'Content-Type': 'application/json'}
        if control:
            headers['Authorization'] = 'Bearer ' + oauth
        else:
            headers['Cookie'] = 'CF_Authorization=' + jwt
            headers['Cf-Access-Jwt-Assertion'] = jwt
        req = urllib.request.Request(url, headers=headers, data=None if body is None else json.dumps(body).encode())
        with urllib.request.urlopen(req, timeout=120) as response:
            return json.load(response)

    base = f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/workers/durable_objects/namespaces'
    namespaces = []
    page = 1
    while True:
        response = request(base + f'?per_page=1000&page={page}', control=True)
        namespaces.extend(n for n in response['result'] if n['script'] == WORKER and n['class'] in ['FlueIphoneAssistantAgent', 'FlueGithubLearningAgent'])
        info = response.get('result_info', {})
        if page * 1000 >= info.get('total_count', 0):
            break
        page += 1
    report = {'worker': WORKER, 'account': ACCOUNT, 'applied': args.apply, 'objects': [], 'failures': []}
    for namespace in namespaces:
        cursor = None
        seen = set()
        while True:
            url = base + '/' + namespace['id'] + '/objects?limit=1000'
            if cursor:
                url += '&cursor=' + urllib.parse.quote(cursor)
            response = request(url, control=True)
            objects = [o for o in response['result'] if o['id'] not in seen]
            for obj in objects:
                seen.add(obj['id'])
                if not obj.get('hasStoredData'):
                    continue
                item = {'class': namespace['class'], 'objectId': obj['id'], 'status': 'inventoried'}
                if args.apply:
                    body = {'kind': 'general' if namespace['class'] == 'FlueIphoneAssistantAgent' else 'repository', 'objectId': obj['id']}
                    for attempt in range(3):
                        try:
                            item.update(request(ORIGIN + '/api/migrate/object', body))
                            break
                        except (urllib.error.URLError, TimeoutError) as error:
                            if attempt == 2:
                                item['status'] = 'needs-review'
                                item['error'] = type(error).__name__
                            else:
                                time.sleep(2 ** attempt)
                report['objects'].append(item)
                if item['status'] == 'needs-review':
                    report['failures'].append(item)
                pathlib.Path(args.report).write_text(json.dumps(report, indent=2))
            next_cursor = response.get('result_info', {}).get('cursor')
            if not objects or not next_cursor or next_cursor == cursor:
                break
            cursor = next_cursor
    counts = {}
    for item in report['objects']:
        counts[item['status']] = counts.get(item['status'], 0) + 1
    report['counts'] = counts
    pathlib.Path(args.report).write_text(json.dumps(report, indent=2))
    print(json.dumps({'worker': WORKER, 'counts': counts, 'report': args.report}))
    if report['failures']:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
