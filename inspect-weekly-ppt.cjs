const JSZip = require("jszip"); const fs = require("fs");

(async () => {
  const buf = fs.readFileSync("C:/Users/HTF2026/Desktop/【6.20-6.26】极狐区域号周度汇报(1).pptx");
  const z = await JSZip.loadAsync(buf);
  
  // 1. Slide count
  const slides = z.file(/ppt\/slides\/slide\d+\.xml/);
  console.log("SLIDES:", slides.length);
  
  // 2. Theme colors
  const theme = await z.file("ppt/theme/theme1.xml")?.async("string");
  if (theme) {
    const srgb = [...theme.matchAll(/<a:srgbClr val="([0-9A-F]+)"/g)].map(m=>m[1]);
    console.log("THEME srgbClr:", [...new Set(srgb)].join(" "));
  }
  
  // 3. Read all slides
  for (const f of slides) {
    const xml = await f.async("string");
    const txt = [...xml.matchAll(/<a:t>([^<]{1,120})/g)]
      .map(m=>m[1].trim()).filter(Boolean);
    const layoutRef = xml.match(/r:id="(rId\d+)"[^>]*>\s*<p:sldLayout/)?.[1] 
      || xml.match(/<p:sldLayout[^>]*r:id="([^"]+)"/)?.[1];
    console.log(`\n=== ${f.name} (layoutRef=${layoutRef}) ===`);
    console.log("  texts:", JSON.stringify(txt.slice(0,15)));
    
    const offs = [...xml.matchAll(/<a:off x="(\d+)" y="(\d+)"/g)].map(m=>`(${m[1]},${m[2]})`);
    console.log("  positions:", offs.join(" "));
    
    const fills = [...xml.matchAll(/<a:solidFill><a:srgbClr val="([0-9A-F]+)"/g)].map(m=>m[1]);
    console.log("  fills:", [...new Set(fills)].join(" "));
  }

  // 4. Check slide masters
  const masters = z.file(/ppt\/slideMasters\/slideMaster\d+\.xml/);
  for (const mf of masters) {
    const xml = await mf.async("string");
    const srgb = [...xml.matchAll(/<a:srgbClr val="([0-9A-F]+)"/g)].map(m=>m[1]);
    console.log(`\nMASTER ${mf.name}: colors=${[...new Set(srgb)].join(" ")}`);
  }
})();
