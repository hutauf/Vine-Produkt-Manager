import shopTemplate from '../shop.html?raw';
import { Product } from '../types';
import { apiGetImages } from './apiService';

export interface ShopOptions {
  email: string;
  percent: number;
  reference: 'etv' | 'teilwert';
  showDiscount: boolean;
}

interface ShopProduct {
  asin: string;
  name: string;
  full_price: number;
  reduced_price?: number;
  image_urls: string[];
}

export async function generateShopHtml(products: Product[], options: ShopOptions): Promise<string> {
  const imageData = await apiGetImages(products.map(p => p.ASIN));
  const shopProducts: ShopProduct[] = products.map(p => {
    const ref = options.reference === 'etv' ? p.etv : (p.myTeilwert ?? p.teilwert ?? 0);
    const target = ref * (options.percent / 100);
    const ids = imageData[p.ASIN] || [];
    const urls = ids.map(id => 
      id.length < 15 
        ? `https://m.media-amazon.com/images/I/${id}._AC_500_.jpg` 
        : id
    );
    return {
      asin: p.ASIN,
      name: p.name,
      full_price: options.showDiscount ? p.etv : target,
      reduced_price: options.showDiscount ? target : undefined,
      image_urls: urls
    };
  });

  return shopTemplate
    .replace('__PRODUCT_DATA__', JSON.stringify(shopProducts))
    .replace('__RECIPIENT_EMAIL__', JSON.stringify(options.email || ''));
}
