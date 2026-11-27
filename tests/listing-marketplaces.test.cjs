const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, '..', 'injected.js'), 'utf8');
const nftAddress = 'EQCWdmVdwq3KAuEkmYgJnbIDeuqu4Y53iGONPAWiEQgyU7Co';
const rawNftAddress = '0:9676655dc2adca02e1249988099db2037aeaaee18e7788638d3c05a211083253';
const saleAddress = 'EQByKsVarHVs0QpLGrO6eMqokRHAFdYOm5HedQAHLenLx3N7';

function createInterceptor() {
  let response;
  let nextData;
  let onMessage;
  let listings = {};
  const window = {
    fetch: async () => ({ clone: () => ({ json: async () => response }) }),
    addEventListener: (_, listener) => { onMessage = listener; },
    postMessage: ({ type, data }) => {
      if (type === 'GETGEMS_MARKER_NFT_DATA') listings = structuredClone(data);
    }
  };
  const document = { getElementById: () => ({ textContent: JSON.stringify(nextData) }) };
  vm.runInNewContext(script, { window, document, console: { log() {}, error: console.error }, URL, atob });

  return {
    async feed(data) {
      response = { data };
      await window.fetch('https://getgems.io/graphql/?operationName=getNftByAddress');
      return listings;
    },
    extract(pageProps) {
      nextData = { props: { pageProps } };
      onMessage({ source: window, data: { type: 'GETGEMS_MARKER_EXTRACT_PAGE_DATA' } });
      return listings;
    }
  };
}

function fixedPrice(overrides = {}) {
  return {
    __typename: 'NftSaleFixPrice',
    address: saleAddress,
    networkFee: '0',
    currency: 'TON',
    fullPrice: '1000000001',
    ...overrides
  };
}

function collection(...items) {
  return { alphaNftItemSearch: { edges: items.map(node => ({ node })) } };
}

test('external listing sources take precedence over offchain and currency defaults', async () => {
  const listings = await createInterceptor().feed(collection(
    { address: 'mrkt', kind: 'OffchainNft', sale: { ...fixedPrice(), marketplace: 'MRKT', currency: 'USDT' } },
    { address: 'portals', kind: 'OffchainNft', sale: { type: 'ExternalSale', link: 'https://t.me/portals/market?startapp=gift' } },
    { address: 'telegram', kind: 'OffchainNft', sale: { type: 'ExternalSale', link: 'https://t.me/nft/EasterEgg-105105' } },
    { address: 'unknown', kind: 'OffchainNft', sale: { type: 'ExternalSale', link: 'https://t.me/another_bot?startapp=portals' } }
  ));

  assert.equal(listings.mrkt.marketplace, 'mrkt');
  assert.equal(listings.portals.marketplace, 'portals');
  assert.equal(listings.telegram.marketplace, 'telegram');
  assert.equal(listings.unknown.marketplace, null);
});

test('fixed-price fallback compares the NFT and sale contract and keeps exact prices', async () => {
  const [fragment, unknown, getgems] = await Promise.all([
    { address: rawNftAddress },
    { address: saleAddress },
    { address: saleAddress, networkFee: '300000000' }
  ].map(async sale => (await createInterceptor().feed(collection({
    address: nftAddress,
    sale: fixedPrice(sale)
  })))[nftAddress]));

  assert.equal(fragment.marketplace, 'fragment');
  assert.equal(unknown.marketplace, null);
  assert.equal(unknown.fullPriceTon, '1.000000001');
  assert.equal(getgems.marketplace, 'getgems');
});

test('collection responses identify a Telegram sale from its fee and separate sale contract', async () => {
  const item = { address: nftAddress, kind: 'CollectionItem' };
  const telegramSale = fixedPrice({ networkFee: '4800000' });
  const [telegram, sameContract, differentFee, explicitGetgems] = await Promise.all([
    telegramSale,
    { ...telegramSale, address: rawNftAddress },
    { ...telegramSale, networkFee: '4800001' },
    { ...telegramSale, marketplace: 'GETGEMS' }
  ].map(async sale => (await createInterceptor().feed(collection({ ...item, sale })))[nftAddress]));

  assert.equal(telegram.marketplace, 'telegram');
  assert.equal(sameContract.marketplace, null);
  assert.equal(differentFee.marketplace, null);
  assert.equal(explicitGetgems.marketplace, 'getgems');
});

test('a Telegram label in the feed does not override the signature of a Fragment listing', async () => {
  const interceptor = createInterceptor();
  const item = { address: nftAddress, kind: 'CollectionItem' };
  const fragmentSale = fixedPrice({ address: nftAddress });

  const initial = await interceptor.feed(collection({ ...item, sale: fragmentSale }));
  const filtered = await interceptor.feed(collection({
    ...item,
    sale: { ...fragmentSale, address: rawNftAddress, marketplace: 'TELEGRAM' }
  }));
  const telegramSale = await interceptor.feed({
    nft: { ...item, sale: fixedPrice({ marketplace: 'TELEGRAM' }) }
  });

  assert.equal(initial[nftAddress].marketplace, 'fragment');
  assert.equal(filtered[nftAddress].marketplace, 'fragment');
  assert.equal(telegramSale[nftAddress].marketplace, 'telegram');
});

test('item data updates a listing, retains its source for partial sale data, and clears it on delisting', async () => {
  const interceptor = createInterceptor();
  const item = { __typename: 'NftItem', address: nftAddress };
  const initialPage = {
    gqlCache: {
      ['NftItem:' + nftAddress]: { ...item, sale: { __ref: 'sale' } },
      sale: fixedPrice()
    }
  };
  const extracted = interceptor.extract(initialPage);
  assert.equal(extracted[nftAddress].marketplace, null);

  const identified = await interceptor.feed({
    nft: { ...item, sale: fixedPrice({ networkFee: '4800000', marketplace: 'TELEGRAM' }) }
  });
  assert.equal(identified[nftAddress].marketplace, 'telegram');

  const partial = await interceptor.feed(collection({ ...item, sale: { address: saleAddress, fullPrice: '2000000000' } }));
  assert.equal(partial[nftAddress].marketplace, 'telegram');
  assert.equal(partial[nftAddress].fullPriceTon, '2');

  const delisted = await interceptor.feed({ nft: { ...item, sale: null } });
  assert.equal(delisted[nftAddress].marketplace, null);
  assert.equal(delisted[nftAddress].fullPriceNano, null);

  const afterStaleSnapshot = interceptor.extract(initialPage);
  assert.equal(afterStaleSnapshot[nftAddress].fullPriceNano, null);
});

test('partial external sales retain their marketplace only for the same external listing', async () => {
  const interceptor = createInterceptor();
  const item = { address: 'gift', kind: 'OffchainNft' };
  const sale = { __typename: 'NftSaleFixPriceExternal', externalId: 'listing', fullPrice: '5370000000' };

  const identified = await interceptor.feed(collection({ ...item, sale: { ...sale, marketplace: 'PORTALS' } }));
  const partial = await interceptor.feed(collection({ ...item, sale }));
  const otherListing = await interceptor.feed(collection({ ...item, sale: { ...sale, externalId: 'new-listing' } }));

  assert.equal(identified.gift.marketplace, 'portals');
  assert.equal(partial.gift.marketplace, 'portals');
  assert.equal(otherListing.gift.marketplace, null);
});
