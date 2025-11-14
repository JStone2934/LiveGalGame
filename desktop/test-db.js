// 测试数据库
const DatabaseManager = require('./src/db/database');

console.log('Testing database...');

const db = new DatabaseManager();

try {
  // 插入示例数据
  db.seedSampleData();

  // 获取所有角色
  console.log('\n=== All Characters ===');
  const characters = db.getAllCharacters();
  console.log(JSON.stringify(characters, null, 2));

  // 获取单个角色
  console.log('\n=== Get Miyu ===');
  const miyu = db.getCharacterById('miyu');
  console.log(JSON.stringify(miyu, null, 2));

  // 获取角色统计
  console.log('\n=== Miyu Stats ===');
  const stats = db.getCharacterStats('miyu');
  console.log(JSON.stringify(stats, null, 2));

  // 更新角色好感度
  console.log('\n=== Update Miyu Affinity ===');
  const updated = db.updateCharacter('miyu', { affinity: 80 });
  console.log('Updated affinity:', updated.affinity);

  // 创建对话
  console.log('\n=== Create Conversation ===');
  const conversation = db.createConversation({
    character_id: 'miyu',
    title: '樱花下的约定',
    affinity_change: 10,
    summary: '一起讨论了去公园看樱花的计划'
  });
  console.log('Created conversation:', conversation);

  // 创建消息
  console.log('\n=== Create Messages ===');
  const message1 = db.createMessage({
    conversation_id: conversation.id,
    sender: 'character',
    content: '哦，真的吗？我刚才还在想，待会儿要不要去散散步。这个季节的樱花应该很美。'
  });
  console.log('Message 1:', message1);

  const message2 = db.createMessage({
    conversation_id: conversation.id,
    sender: 'user',
    content: '听起来真不错！也许我们可以一起去？'
  });
  console.log('Message 2:', message2);

  // 获取对话的消息
  console.log('\n=== Get Conversation Messages ===');
  const messages = db.getMessagesByConversation(conversation.id);
  console.log(JSON.stringify(messages, null, 2));

  console.log('\n✅ Database test completed successfully!');

} catch (error) {
  console.error('❌ Database test failed:', error);
} finally {
  db.close();
}
