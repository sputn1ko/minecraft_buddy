const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const { plugin: pvp } = require('mineflayer-pvp')
const readline = require('readline')

const config = {
  host: process.env.MC_HOST || '127.0.0.1',
  port: Number(process.env.MC_PORT || 25565),
  username: process.env.BOT_NAME || 'BuddyBot',
  // "offline" is intended for compatible local LAN worlds only.
  auth: process.env.MC_AUTH || 'offline'
}

let bot
let followTarget = null
let guardMode = false
let busy = false

function log(message) {
  console.log(`[Buddy] ${message}`)
}

function startBot() {
  log(`Подключаюсь к ${config.host}:${config.port} как ${config.username}...`)
  bot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth
  })

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(collectBlock)
  bot.loadPlugin(pvp)

  bot.once('spawn', () => {
    const movements = new Movements(bot)
    movements.canDig = true
    movements.allow1by1towers = false
    bot.pathfinder.setMovements(movements)
    log('Я в мире! Напиши help в этой консоли, чтобы увидеть команды.')
  })

  bot.on('chat', (username, message) => {
    if (!username || username === bot.username) return
    const text = message.trim()
    // Commands can be issued in Minecraft chat with !buddy <command>.
    if (text.toLowerCase().startsWith('!buddy ')) {
      handleCommand(text.slice(7), username, true)
    } else if (text.toLowerCase() === '!buddy') {
      bot.chat('Напиши !buddy help')
    }
  })

  bot.on('kicked', reason => log(`Меня отключили: ${JSON.stringify(reason)}`))
  bot.on('error', err => log(`Ошибка: ${err.message}`))
  bot.on('end', () => log('Соединение закрыто. Закрой окно и запусти start.bat заново, чтобы переподключиться.'))
}

function getPlayer(username) {
  return bot.players[username]?.entity
}

function findBlock(name) {
  const blockType = bot.registry.blocksByName[name]
  if (!blockType) throw new Error(`Не знаю блок "${name}". Используй английское имя, например oak_log.`)
  const blocks = bot.findBlocks({ matching: blockType.id, maxDistance: 48, count: 30 })
  if (!blocks.length) throw new Error(`Не вижу рядом блок ${name} в радиусе 48 блоков.`)
  return blocks.map(pos => bot.blockAt(pos)).filter(Boolean)
}

async function doCollect(name) {
  if (busy) return log('Я уже выполняю задачу. Сначала напиши stop.')
  busy = true
  try {
    const blocks = findBlock(name)
    log(`Собираю ${name}...`)
    await bot.collectBlock.collect(blocks.slice(0, 12))
    log(`Готово. Собрал доступные блоки ${name}.`)
  } catch (e) {
    log(`Не получилось собрать: ${e.message}`)
  } finally {
    busy = false
  }
}

function handleCommand(raw, issuer = '', fromChat = false) {
  if (!bot || !bot.entity) return log('Я ещё не появился в мире.')
  const parts = raw.trim().split(/\s+/)
  const cmd = (parts.shift() || '').toLowerCase()
  const arg = parts.join('_').toLowerCase()
  const reply = message => {
    log(message)
    if (fromChat) bot.chat(message.slice(0, 240))
  }

  try {
    if (cmd === 'help') {
      reply('Команды: follow, come, stop, guard, collect <block>, status, say <text>. В чате: !buddy help')
    } else if (cmd === 'follow') {
      const target = issuer || parts[0]
      if (!target) return reply('Укажи игрока: follow ИмяИгрока')
      if (fromChat && issuer) followTarget = issuer
      else followTarget = target
      guardMode = false
      reply(`Буду следовать за ${followTarget}.`)
    } else if (cmd === 'come') {
      const targetName = issuer || parts[0]
      const target = getPlayer(targetName)
      if (!target) return reply(`Не вижу игрока ${targetName}. Подойди поближе.`)
      followTarget = null
      bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 1))
      reply('Иду к тебе.')
    } else if (cmd === 'stop') {
      followTarget = null
      guardMode = false
      bot.pathfinder.setGoal(null)
      bot.pvp.stop()
      reply('Остановился.')
    } else if (cmd === 'guard') {
      guardMode = !guardMode
      followTarget = null
      if (guardMode) reply('Режим охраны включён: буду атаковать ближайших враждебных мобов.')
      else {
        bot.pvp.stop()
        reply('Режим охраны выключен.')
      }
    } else if (cmd === 'collect' || cmd === 'mine') {
      if (!arg) return reply('Укажи блок на английском: collect oak_log')
      doCollect(arg)
    } else if (cmd === 'status') {
      const p = bot.entity.position
      reply(`Позиция: ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}. Режим: ${guardMode ? 'охрана' : followTarget ? 'следую' : busy ? 'сбор' : 'ожидание'}.`)
    } else if (cmd === 'say') {
      const message = parts.join(' ')
      if (!message) return reply('После say напиши текст.')
      bot.chat(message.slice(0, 240))
    } else {
      reply('Не знаю такую команду. Напиши help.')
    }
  } catch (e) {
    reply(`Ошибка команды: ${e.message}`)
  }
}

let eating = false
const edibleNames = [
  'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken',
  'cooked_rabbit', 'cooked_cod', 'cooked_salmon', 'baked_potato',
  'bread', 'carrot', 'golden_carrot', 'apple', 'melon_slice',
  'sweet_berries', 'glow_berries', 'cookie', 'pumpkin_pie',
  'beetroot', 'beetroot_soup', 'mushroom_stew', 'rabbit_stew',
  'cooked_fish', 'porkchop', 'beef', 'mutton', 'chicken', 'potato'
]

async function tryAutoEat() {
  if (!bot || !bot.entity || eating || bot.food >= 14) return
  const food = bot.inventory.items().find(item => edibleNames.includes(item.name))
  if (!food) return
  eating = true
  try {
    await bot.equip(food, 'hand')
    await bot.consume()
    log(`Перекусил: ${food.name}.`)
  } catch (_) {
    // If eating is interrupted by combat or movement, try again on a later tick.
  } finally {
    eating = false
  }
}

setInterval(() => {
  if (!bot || !bot.entity) return
  tryAutoEat()
  if (followTarget) {
    const target = getPlayer(followTarget)
    if (target) {
      const distance = bot.entity.position.distanceTo(target.position)
      if (distance > 3) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
      } else {
        bot.pathfinder.setGoal(null)
      }
    }
  }

  if (guardMode) {
    const hostileNames = new Set([
      'zombie', 'skeleton', 'stray', 'husk', 'drowned', 'creeper',
      'spider', 'cave_spider', 'witch', 'pillager', 'vindicator',
      'evoker', 'ravager', 'phantom', 'enderman', 'slime', 'magma_cube'
    ])
    const target = bot.nearestEntity(entity =>
      entity.type === 'mob' &&
      hostileNames.has(entity.name) &&
      entity.position.distanceTo(bot.entity.position) < 12
    )
    if (target && bot.inventory.items().some(item =>
      /sword|axe|trident/.test(item.name)
    )) {
      bot.pvp.attack(target)
    } else if (!target) {
      bot.pvp.stop()
    }
  }
}, 700)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.on('line', line => {
  const trimmed = line.trim()
  if (!trimmed) return
  const [command, ...args] = trimmed.split(/\s+/)
  handleCommand([command, ...args].join(' '), '', false)
})

startBot()
