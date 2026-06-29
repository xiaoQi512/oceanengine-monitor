const JSZip = require("jszip"); const fs = require("fs");

(async () => {
  const buf = fs.readFileSync("C:/Users/HTF2026/Desktop/【6.20-6.26】极狐区域号周度汇报(1).pptx");
  const z = await JSZip.loadAsync(buf);

  const slide2 = await z.file("ppt/slides/slide2.xml").async("string");
  
  console.log("Has table:", slide2.includes("<a:tbl>"));
  
  // Extract all shapes with position + text
  const shapes = [...slide2.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)];
  console.log("Total sp shapes:", shapes.length);
  
  shapes.forEach(s => {
    const off = s.match(/<a:off x="(\d+)" y="(\d+)"/);
    const ext = s.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
    const fill = s.match(/<a:solidFill><a:srgbClr val="([0-9A-F]+)"/);
    const txt = s.match(/<a:t>([^<]+)<\/a:t>/);
    if (off) {
      const x = parseInt(off[1]), y = parseInt(off[2]);
      const cx = ext ? parseInt(ext[1]) : 0, cy = ext ? parseInt(ext[2]) : 0;
      const text = txt ? txt[1] : "";
      const f = fill ? fill[1] : "none";
      console.log(`  y=${y} fill=${f} text="${text.substring(0,40)}"`);
    }
  });
  
  // Check if there's a table by looking for <a:tbl> elements
  const tables = [...slide2.matchAll(/<a:tbl>[\s\S]*?<\/a:tbl>/g)];
  console.log("\nTable elements:", tables.length);
  tables.forEach((tbl, i) => {
    const txts = [...tbl[0].matchAll(/<a:t>([^<]+)<\/a:t>/g)].map(m=>m[1]);
    console.log(`  Table ${i}:`, txts.slice(0,20).join(" | "));
  });
})();
