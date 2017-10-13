var http = require('http');
var mysql = require('mysql');


//サーバインスタンス作成
var server = http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type':'text/html'});
  res.end('server connected');
});
var io = require('socket.io').listen(server);

server.listen(1111);//8888番ポートで起動


// DB に接続
var connection = mysql.createConnection({
  host : 'localhost',
  user : '****',
  password : '****',
  database : '****'
});


// ログイン機能
var login = io.of('/login').on('connection', function(socket) {
  socket.on('client_to_server_personal', function(data) {
    var id = socket.id;
    select_rooms(id);
  });
});


// 部屋選択機能
var rooms_select = io.of('/rooms').on('connection', function(socket) {
  // 部屋が既に存在しているかどうか確認
  socket.on('client_to_server', function(data) {
    var room = data.value;
    var id = socket.id;
    exist_room(room, id);
  });

  // 部屋を作成したことを他の人に送信
  socket.on('client_to_server_broadcast', function(data) {
    socket.broadcast.emit('server_to_client_add_room', {value : [ {room : data.value, num : '1'} ]});
  });
});


// チャット機能
var chat = io.of('/chat').on('connection', function(socket) {

  // 部屋への入室処理
  socket.on('client_to_server_join', function(data) {
    var name = data.name;
    var room = data.room;
    var id = socket.id;
    //console.log(room);
    socket.broadcast.to(room).emit("server_to_client_enter_member", {name : name});
    // 既に部屋がある場合
    if (data.code == 'exist') {
      enter_room(name, room, id);
    }
    // 新規作成の場合
    else {
      insert_room(name, room, id);
    }
    socket.join(room);
  });

  // 入室メッセージ（他人用）の送信
  socket.on('client_to_server_broadcast', function(data) {
    var room = data.room;
    socket.broadcast.to(room).emit('server_to_client', {value : data.mess});
  });

  // 入室メッセージ（自分用）の送信
  socket.on('client_to_server_personal', function(data) {
    var id = socket.id;
    var room = data.room;
    var personal_msg = room + "に入室しました。";
    chat.to(id).emit('server_to_client', {value : personal_msg});
  });

  // チャットメッセージの送信
  socket.on('client_to_server', function(data) {
    var room = data.room;
    chat.to(room).emit('server_to_client', {value : data.mess});
  });

  // client_to_server_return 部屋一覧画面へ戻る際の処理
  socket.on('client_to_server_return', function(data) {
    var id = socket.id;
    var room = data.room;
    socket.leave(room);
    del_member(id);
  });

  // 切断時に退出メッセージを送信する
  socket.on('disconnect', function() {
    var id = socket.id;
    del_member(id);
  });
});


// 部屋情報の保存
function insert_room(name, room, id) {
  connection.query({
    sql : 'insert into rooms(room, num) value(?, "1")',
    timeout : 40000,
    values : [room]
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      insert_member(name, room, id);
    }
  });
}


// 入室処理
function enter_room(name, room, id) {
  connection.query({
    sql : 'update rooms set num=num+1 where room=?',
    timeout : 40000,
    values : [room]
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      // 部屋の入室人数の確認と送信
      connection.query({
        sql : 'select num from rooms where room=?',
        timeout : 40000,
        values : [room]
      }, function (error, results, fields) {
        rooms_select.emit('server_to_client_room_num', {room : room, num : results[0].num});
        insert_member(name, room, id);
      });
    }
  });
}


// 入室者の保存
function insert_member(name, room, id) {
  connection.query({
    sql : 'insert into members(room, name, socket_id) value(?, ?, ?)',
    timeout : 40000,
    values : [room, name, id]
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      room_member(room, id);
    }
  });
}


// 部屋一覧の取得
function select_rooms(id) {
  connection.query({
    sql : 'select * from rooms',
    timeout : 40000,
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      login.to(id).emit('server_to_client', {value : results});
    }
  });
}


// 部屋の存在確認
function exist_room(room, id) {
  connection.query({
    sql : 'select * from rooms where room=?',
    timeout : 40000,
    values : [room]
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      if (results != '') {
        rooms_select.to(id).emit('server_to_client', {value : "true"});
      } else {
        rooms_select.to(id).emit('server_to_client', {value : "false"});
      }
    }
  });
}


// 入室者の確認
function room_member(room, id) {
  connection.query({
    sql : 'select name from members where room=?',
    timeout : 40000,
    values : [room]
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    } else {
      chat.to(id).emit('server_to_client_room_member', {names : results});
    }
  });
}


// 退室処理
function leave_room(room) {
  connection.query({
    sql : 'update rooms set num=num-1 where room=?',
    timeout : 40000,
    values : [room]
  }, function (error, results, fields) {
    // 部屋の入室人数の確認と送信
    connection.query({
      sql : 'select num from rooms where room=?',
      timeout : 40000,
      values : [room]
    }, function (error, results, fields) {
      rooms_select.emit('server_to_client_room_num', {room : room, num : results[0].num});
      del_room();
    });
  });
}


// 退室者の削除
function del_member(id) {
  connection.query({
    sql : 'select room, name from members where socket_id=?',
    timeout : 40000,
    values : [id]
  }, function (error, results, fields) {
    if (results != '') {
      var room = results[0].room;
      var name = results[0].name;
      var out_mess = name + 'さんが退室しました。';
      chat.to(room).emit('server_to_client', {value : out_mess});
      // menbers の delete
      connection.query({
        sql : 'delete from members where socket_id=?',
        timeout : 40000,
        values : [id]
      }, function (error, results, fields) {
        if (error) {
          console.log('error : ' + error);
        }
        chat.to(room).emit("server_to_client_leave_member", {name : name});
        leave_room(room);
      });
    }
  });
}


// 空部屋の削除
function del_room() {
  connection.query({
    sql : 'delete from rooms where num=?',
    timeout : 40000,
    values : ['0']
  }, function (error, results, fields) {
    if (error) {
      console.log('error : ' + error);
    }
  });
}
