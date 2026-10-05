import test from 'node:test';
import assert from 'node:assert/strict';
import { getEmbedHosts, isAllowedEmbedUrl, isAllowedEmbedHost, frameSrcSources } from '../src/shared/embedHosts.js';

test('cho phép các dịch vụ nhúng phổ biến (kể cả tên miền con)', () => {
  assert.ok(isAllowedEmbedUrl('https://www.canva.com/design/DAGBEKC8YbE/Qm3Stcq68MYnXpXUuQnSJQ/view?embed'));
  assert.ok(isAllowedEmbedUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'));
  assert.ok(isAllowedEmbedUrl('https://player.vimeo.com/video/76979871'));
  assert.ok(isAllowedEmbedUrl('https://docs.google.com/presentation/d/abc/embed'));
});

test('từ chối http, tên miền lạ, tên miền giả mạo và thông tin đăng nhập trong URL', () => {
  assert.equal(isAllowedEmbedUrl('http://www.youtube.com/embed/x'), false);
  assert.equal(isAllowedEmbedUrl('https://evil.example.com/x'), false);
  assert.equal(isAllowedEmbedUrl('https://youtube.com.evil.example/x'), false);
  assert.equal(isAllowedEmbedUrl('https://notyoutube.com/x'), false);
  assert.equal(isAllowedEmbedUrl('https://user:pass@www.youtube.com/embed/x'), false);
  assert.equal(isAllowedEmbedUrl('javascript:alert(1)'), false);
  assert.equal(isAllowedEmbedUrl('not a url'), false);
});

test('EMBED_EXTRA_HOSTS mở rộng danh sách và bỏ qua giá trị rác', () => {
  const hosts = getEmbedHosts('example.org, https://foo.bar/path, ,*.wild.com, bad host');
  assert.ok(isAllowedEmbedHost('example.org', hosts));
  assert.ok(isAllowedEmbedHost('sub.foo.bar', hosts));
  assert.equal(isAllowedEmbedHost('wild.com', hosts), false);
  assert.equal(isAllowedEmbedHost('bad host', hosts), false);
});

test('frame-src sinh cả tên miền gốc lẫn tên miền con', () => {
  const src = frameSrcSources(['canva.com']);
  assert.deepEqual(src, ['https://canva.com', 'https://*.canva.com']);
});
