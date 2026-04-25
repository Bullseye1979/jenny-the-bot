const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');
const fs = require('fs');

const doc = new Document({
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    children: [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun("Hallo Welt")]
      })
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("hallo-welt.docx", buffer);
  console.log("hallo-welt.docx created.");
});
