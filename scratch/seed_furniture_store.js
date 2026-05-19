const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();

async function main() {
  const email = 'furniture_vendor@test.com';
  const password = 'password123';
  const passwordHash = await bcrypt.hash(password, 10);

  // 1. Create or update vendor user
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'VENDOR',
      status: 'ACTIVE'
    },
    create: {
      email,
      name: 'Z-Home Furnishings Owner',
      passwordHash,
      role: 'VENDOR',
      status: 'ACTIVE',
      emailVerified: true
    }
  });

  // 2. Delete existing test home_furnishing restaurant/items if any to allow clean re-runs
  const existingRests = await prisma.restaurant.findMany({
    where: { ownerId: user.id }
  });
  for (const r of existingRests) {
    // Delete items
    const sections = await prisma.menuSection.findMany({ where: { restaurantId: r.id } });
    for (const s of sections) {
      await prisma.foodItem.deleteMany({ where: { sectionId: s.id } });
    }
    await prisma.menuSection.deleteMany({ where: { restaurantId: r.id } });
    await prisma.restaurant.delete({ where: { id: r.id } });
  }

  // 3. Create a Home & Furnishing store
  const restaurant = await prisma.restaurant.create({
    data: {
      ownerId: user.id,
      name: 'Z-Home Furnishings & Bedding',
      nameAr: 'زد هوم للأثاث والمفروشات',
      address: '92 Mohamed Faried St., Nozha, Heliopolis, Cairo',
      city: 'Cairo',
      latitude: 30.0963,
      longitude: 31.3261,
      isActive: true,
      isOpen: true,
      status: 'ACTIVE',
      deliveryFee: 25,
      deliveryTimeMin: 30,
      deliveryTimeMax: 60,
      minimumOrder: 100,
      deliveryRadiusKm: 15,
      vendorType: 'home_furnishing',
      logoUrl: 'https://images.unsplash.com/photo-1524758631624-e2822e304c36?w=400',
      coverImageUrl: 'https://images.unsplash.com/photo-1616486338812-3dadae4b4ace?w=1200'
    }
  });

  // 4. Create premium sections
  const sectionsData = [
    { name: 'Bedding & Mattress Covers', nameAr: 'المفروشات وأغطية المراتب', sortOrder: 1 },
    { name: 'Pillows & Cushions', nameAr: 'الوسائد والخداديات', sortOrder: 2 },
    { name: 'Blankets & Quilts', nameAr: 'البطاطين والألحفة', sortOrder: 3 },
  ];

  const sections = {};
  for (const sd of sectionsData) {
    const s = await prisma.menuSection.create({
      data: {
        restaurantId: restaurant.id,
        name: sd.name,
        nameAr: sd.nameAr,
        sortOrder: sd.sortOrder,
        isActive: true
      }
    });
    sections[sd.name] = s;
  }

  // 5. Populate products with structured retail metadata in the 'addons' JSON field
  const products = [
    {
      sectionId: sections['Bedding & Mattress Covers'].id,
      name: 'Mattress Protector Comforter',
      nameAr: 'واقي مرتبة ولحاف فندقي',
      description: 'Premium waterproof mattress protector comforter, breathable dimple knit cover. Soft touch and durable protective layer.',
      descriptionAr: 'واقي مرتبة ولحاف مقاوم للماء عالي الجودة، غطاء ناعم وجيد التهوية للحماية التامة من السوائل والأتربة.',
      price: 625,
      originalPrice: 750,
      isOnSale: true,
      stockQuantity: 150,
      isAvailable: true,
      imageUrl: 'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=800',
      addons: {
        productClass: 'bedding',
        attributes: {
          material: '80% Cotton, 20% Polyester',
          features: ['Waterproof', 'Breathable Dimple Knit', 'Soft Touch'],
          specifications: 'Durable protective layer against spills and accidents',
          careInstructions: 'Machine washable, tumble dry low'
        },
        variations: [
          {
            name: 'Size',
            nameAr: 'المقاس',
            options: [
              { value: 'Twin 100*200', valueAr: 'فردي ١٠٠*٢٠٠', priceAdjustment: 0.0 },
              { value: 'Twin XL 120*200', valueAr: 'فردي كبير ١٢٠*٢٠٠', priceAdjustment: 75.0 },
              { value: 'Full 140*200', valueAr: 'شبه مزدوج ١٤٠*٢٠٠', priceAdjustment: 150.0 },
              { value: 'Full XL 160*200', valueAr: 'مزدوج ١٦٠*٢٠٠', priceAdjustment: 225.0 },
              { value: 'Queen 180*200', valueAr: 'كبير ١٨٠*٢٠٠', priceAdjustment: 300.0 },
              { value: 'King 200*200', valueAr: 'جامبو ٢٠٠*٢٠٠', priceAdjustment: 375.0 }
            ]
          }
        ]
      }
    },
    {
      sectionId: sections['Pillows & Cushions'].id,
      name: 'Memory Foam Contour Pillow',
      nameAr: 'مخدة فوم طبي علاجية',
      description: 'Ergonomic memory foam contour pillow for orthopedic neck support. Therapeutic comfort with thermodynamic breathable cover.',
      descriptionAr: 'وسادة طبية من الفوم العلاجي لدعم الرقبة والعمود الفقري، تأتي مع غطاء ناعم ينظم الحرارة.',
      price: 450,
      originalPrice: 550,
      isOnSale: true,
      stockQuantity: 80,
      isAvailable: true,
      imageUrl: 'https://images.unsplash.com/photo-1631679706909-1844bbd07221?w=800',
      addons: {
        productClass: 'pillow',
        attributes: {
          filling: 'High-quality Microfiber / Memory Foam',
          comfortLevel: 'Medium Firm',
          hypoallergenic: true,
          thermodynamic: true,
          antibacterial: true,
          careInstructions: 'Washable cover, wipe-clean core'
        },
        variations: [
          {
            name: 'Comfort Level & Style',
            nameAr: 'درجة المرونة والنوع',
            options: [
              { value: 'Soft Classic', valueAr: 'كلاسيك ناعم', priceAdjustment: 0.0 },
              { value: 'Medium Sandwich', valueAr: 'ساندوتش متوسط', priceAdjustment: 50.0 },
              { value: 'Firm Orthopedic', valueAr: 'طبي متماسك', priceAdjustment: 100.0 }
            ]
          }
        ]
      }
    },
    {
      sectionId: sections['Pillows & Cushions'].id,
      name: 'Premium Linen Floor Cushion',
      nameAr: 'شلتة أرضية كتان فاخرة',
      description: 'High-density foam floor cushion, elegant linen texture. Ideal for cozy modern floor seating.',
      descriptionAr: 'وسادة أرضية محشوة بالكامل بفوم عالي الكثافة مع غطاء كتان أنيق، مثالية للجلسات الأرضية العصرية والمريحة.',
      price: 300,
      originalPrice: 350,
      isOnSale: true,
      stockQuantity: 100,
      isAvailable: true,
      imageUrl: 'https://images.unsplash.com/photo-1583847268964-b28dc8f51f92?w=800',
      addons: {
        productClass: 'cushion',
        attributes: {
          filling: 'High-density polyurethane foam',
          cover: '100% Premium Linen fabric',
          dimensions: '45x45 cm',
          careInstructions: 'Removable and machine washable cover'
        }
      }
    }
  ];

  for (const prod of products) {
    await prisma.foodItem.create({
      data: {
        sectionId: prod.sectionId,
        name: prod.name,
        nameAr: prod.nameAr,
        description: prod.description,
        descriptionAr: prod.descriptionAr,
        price: prod.price,
        originalPrice: prod.originalPrice,
        isOnSale: prod.isOnSale,
        stockQuantity: prod.stockQuantity,
        isAvailable: prod.isAvailable,
        imageUrl: prod.imageUrl,
        addons: prod.addons
      }
    });
  }

  console.log(`\n🎉 Test Furniture Store successfully created & seeded!`);
  console.log(`------------------------------------------------------`);
  console.log(`📧 Vendor Login Email:   ${email}`);
  console.log(`🔑 Vendor Password:      ${password}`);
  console.log(`🏬 Store Name:            ${restaurant.name} (${restaurant.nameAr})`);
  console.log(`📍 Location:             ${restaurant.address}`);
  console.log(`✨ Created ${products.length} premium products across ${sectionsData.length} sections!`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
