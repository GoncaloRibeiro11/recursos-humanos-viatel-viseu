"""Prepare private, per-person monthly imports from the reconciled report caches.

Usage: python prepare-commissions.py MAPAS_ROOT OUTPUT_JSON
Never write OUTPUT_JSON under public/ or commit it to the portal repository.
"""
import copy
import json
import re
import sys
from pathlib import Path


def prepare(root):
    base = root / '2026/Historico_HTML_Equipas/tmp'
    sources = [('2025', 'history_2025_data.json'), ('2026', 'history_data.json'),
               ('2026', 'personal_data.json'), ('2026', 'monica_data.json')]
    rows, identities = {}, {}
    fields = ['records', 'productionVdd', 'productionChe', 'adjustments', 'checks']
    for year, filename in sources:
        data = json.loads((base / filename).read_text(encoding='utf-8'))
        for team, months in data.items():
            for month, m in months.items():
                chiefs = [p['id'][1:] for p in m['people'] if p.get('chief')]
                assert len(chiefs) <= 1, (filename, month, 'Ambiguous chief')
                for p in m['people']:
                    nif = p['id'][1:]
                    assert re.fullmatch(r'\d{9}', nif), p['name']
                    assert abs(sum(x['amount'] for x in p['rubrics']) - p['total']) < .005
                    personal = nif in ('246004800', '243591420')
                    payload = {k: copy.deepcopy(v) for k, v in m.items()
                               if k not in fields + ['people']}
                    payload['people'] = [copy.deepcopy(p)]
                    payload['defaultPerson'] = p['id']
                    for field in fields:
                        payload[field] = [copy.deepcopy(x) for x in m.get(field, [])
                                          if x.get('owner') == p['id']]
                    if personal:
                        payload['checks'] = []
                        payload['personalNotice'] = ('O mapa de detalhe não tem uma coluna de comissão '
                            'específica para esta função. O pagamento pessoal segue o mapa de pagamentos; '
                            'não foi repartido pelos clientes.')
                    period = f'{year}-{int(month):02}-01'
                    row = dict(period=period, owner_nif=nif,
                               chief_nif=None if personal else (chiefs[0] if chiefs else None),
                               source_name=p['name'], total=p['total'], payload=payload)
                    key = (period, nif)
                    if key in rows:
                        assert rows[key] == row, (key, 'Conflicting duplicate')
                    rows[key] = row
                    identities[nif] = dict(nif=nif, source_name=p['name'])
    return dict(version=1, identities=sorted(identities.values(), key=lambda x:x['source_name']),
                rows=[rows[k] for k in sorted(rows)])


if __name__ == '__main__':
    root, output = map(Path, sys.argv[1:])
    repo = Path(__file__).resolve().parents[2]
    if output.resolve().is_relative_to(repo):
        raise SystemExit('O ficheiro privado deve ficar fora do repositório do portal.')
    result = prepare(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    print(json.dumps(dict(payments=len(result['rows']), people=len(result['identities']),
                         months=len(set(x['period'] for x in result['rows'])), bytes=output.stat().st_size)))
