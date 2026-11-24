# Water Map – خريطة المياه
PWA عربية (RTL) لتدبير ومراقبة الموارد المائية. البيانات محفوظة محلياً (localStorage) مع تصدير/استيراد JSON وCSV.

## النشر
cd water-map
git init && git add . && git commit -m "Première version"
git branch -M main
git remote add origin https://github.com/mohamedrezzoug/water-map.git
git push -u origin main
ثم GitHub → Settings → Pages → Source: main / root
الرابط: https://mohamedrezzoug.github.io/water-map/

## ملاحظات
- الخريطة: Leaflet + OpenStreetMap (CDN). تحتاج اتصالاً في أول زيارة ثم تُخزَّن.
- عند تعديل الملفات غيّر رقم النسخة في sw.js (watermap-v1 → v2).
- لا توجد بيانات وهمية: كل شيء فارغ حتى يتم الجرد.
