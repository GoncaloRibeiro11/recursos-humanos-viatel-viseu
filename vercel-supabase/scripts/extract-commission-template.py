"""Extract only the empty interactive layout, never the report data or fallback."""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path


class TemplateParser(HTMLParser):
    void = set('area base br col embed hr img input link meta param source track wbr'.split())

    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.parts = []
        self.styles = []
        self.stack = []
        self.in_style = False
        self.in_script = False
        self.runtime_count = 0
        self.shell_count = 0

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag == 'style':
            self.in_style = True
            return
        if tag == 'script':
            self.in_script = True
            self.runtime_count += values.get('id') != 'report-data'
            return
        if values.get('id') == 'interactive-shell':
            if self.stack:
                raise ValueError('Nested report shell')
            self.shell_count += 1
            self.stack = [tag]
            self.parts.append(self.get_starttag_text())
        elif self.stack:
            self.parts.append(self.get_starttag_text())
            if tag not in self.void:
                self.stack.append(tag)

    def handle_endtag(self, tag):
        if tag == 'script':
            self.in_script = False
            return
        if tag == 'style':
            self.in_style = False
            return
        if self.stack and tag in self.stack:
            self.parts.append('</' + tag + '>')
            index = len(self.stack) - 1 - self.stack[::-1].index(tag)
            self.stack = self.stack[:index]

    def handle_startendtag(self, tag, attrs):
        if self.stack:
            self.parts.append(self.get_starttag_text())

    def handle_data(self, data):
        if self.in_style:
            self.styles.append(data)
        elif self.stack and not self.in_script:
            self.parts.append(data)

    def handle_entityref(self, name):
        if self.stack and not self.in_script:
            self.parts.append('&' + name + ';')

    def handle_charref(self, name):
        if self.stack and not self.in_script:
            self.parts.append('&#' + name + ';')


if __name__ == '__main__':
    source, private_import, base_template = map(Path, sys.argv[1:])
    parser = TemplateParser()
    parser.feed(source.read_text(encoding='utf-8'))
    if parser.runtime_count != 1 or parser.shell_count != 1 or parser.stack:
        raise ValueError('Unexpected report structure')
    base = TemplateParser()
    base.feed(base_template.read_text(encoding='utf-8'))
    result = ('<!doctype html><html lang="pt"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Comissões · RH Viatel Viseu</title><style>' + ''.join(base.styles)
        + '</style></head><body><section id="readable-fallback" hidden></section>'
        + ''.join(parser.parts) + '<script id="report-data" type="application/json">{}</script>'
        '<script src="commission-report.js"></script></body></html>')
    result = result.replace('Gonçalo Ribeiro', 'RH Viatel Viseu')
    result = re.sub(r'letter-spacing\s*:[^;}]+', 'letter-spacing:0', result)
    data = json.loads(private_import.read_text(encoding='utf-8-sig'))
    if not 10000 < len(result) < 100000:
        raise ValueError('Unexpected template size')
    if any(i['source_name'] in result for i in data['identities']):
        raise ValueError('A private person name remains in the presentation')
    if re.search(r'(?<!\d)\d{9}(?!\d)', result):
        raise ValueError('An identifier remains in the presentation')
    sys.stdout.buffer.write(result.encode('utf-8'))
