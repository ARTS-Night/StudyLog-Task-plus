window.globalFunction = {iLiSNowSubject:null, iLiSToolLoginFlag:0, iLiSScreenShareHost:null, serverBoostFlag:false};
let WebSocketState = 0;

const WebSocketURL = 'wss://portal.iwasaki.ac.jp:8080/';
const WebSocketPROTOCOL = 'ws-iwasaki-studylog';
const socket = new ReconnectingWebSocket(WebSocketURL, WebSocketPROTOCOL, {timeoutInterval:5000});

let iLiSActionCnts = {hee:0, ok:0, ng:0, wait:0, comment:0};
let iLiSActionLastTime = (new Date()).getTime();
let iLiSContentsDialog = null;
let iLiSOpenCommandTimeId = 0;
let socketLastRecvTime = null;

socket.addEventListener('open', (event) => {
	
  WebSocketState = 1;
  globalFunction.send("sess:" + $.cookie("GlexaSESSID"));
  socketLastRecvTime = (new Date()).getTime();
});

socket.addEventListener('message', ({ data }) => {
	const idx = data.indexOf(':');
	const cmd = idx == -1 ? data : data.substring(0, idx);
	const param = idx == -1 ? '' : data.substring(idx+1);
	
	socketLastRecvTime = (new Date()).getTime();
	
	if(cmd == 'heart'){
		globalFunction.send("heart");
	}
	
	else if(cmd == 'screenShareStarted'){
		let host = param;
		$("#iLiSSharedScreenThumbArea > a > img").attr("src","/portal/img/loading-small.gif");
		$("#iLiSSharedScreenThumbArea").css("display", "inline-block");
		globalFunction.iLiSScreenShareHost = host;
	}
	
	else if(cmd == 'screenShareStopped'){
		$("#iLiSSharedScreenThumbArea").hide();
		globalFunction.iLiSScreenShareHost = null;
	}
	
	else if(cmd == 'screenThumbImage'){
		$("#iLiSSharedScreenThumbArea > a > img").attr("src", param);
	}
	
	else if(cmd == 'sendLink'){
		let obj;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}	
		iLiSOpenCommandTimeId = obj.time;
		
		let html = '<div>';
		html	+= '  <div class="text-center" style="margin-bottom:1em; border-bottom: solid 1px gray;">';
		html	+= '	<img src="/portal/img/iLiS/iLiS2.png" height="80" /><br/><br/>';
		html	+= '  </div>';
		html	+= '  <div>担当の先生からURLが送られてきました。OKを押して開いて下さい<br/><br/><strong>URL: '+obj.url+'</strong></div>';
		html	+= '</div>';
		html	+= '  <div class="text-right" style="margin-top:1em; font-size:80%">※過去の受信URLは科目ページから確認できます</div>';
		
		if(iLiSContentsDialog)
			iLiSContentsDialog.destroy();
		
		iLiSContentsDialog = new tingle.modal({
			footer: true,
			stickyFooter: false,
			closeMethods: ['button'],
			closeLabel: "閉じる",
			onClose: function(){
				let param = {command:cmd, time:obj.time};
				globalFunction.send('recvOK:'+JSON.stringify(param));
			}
		});
		
		iLiSContentsDialog.addFooterBtn('ＯＫ', 'tingle-btn tingle-btn--primary', function() {
			window.open(obj.url);
			iLiSContentsDialog.close();
		});
		iLiSContentsDialog.setContent(html);
		iLiSContentsDialog.open();
	}
	
	else if(cmd == 'sendText'){
		let obj;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}
		iLiSOpenCommandTimeId = obj.time;
		
		iLiSStudentTextView(obj, true);
	}
	
	else if(cmd == 'closeCmd'){
		if(param == iLiSOpenCommandTimeId && iLiSContentsDialog != null){
			iLiSContentsDialog.opts.onClose = null;
			iLiSContentsDialog.close();
		}
	}
	
	else if(cmd == 'quizStart'){
		let obj, w;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}
		iLiSStudentQuizOpen(obj);
	}
	
	else if(cmd == 'quizStop'){
		if(iLiSContentsDialog)
			iLiSContentsDialog.destroy();
	}

	else if(cmd == 'quizEnd'){
		let obj;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}
		//console.log(obj);
		if(iLiSContentsDialog)
			iLiSContentsDialog.destroy();
		
		iLiSOpenCommandTimeId = obj.time;
		
		//クイズの場合は採点結果などを表示
		if(obj.quiz.qType == 'quiz'){
			iLiSStudentQuizResultView(obj);
		}
	}
	
	else if(cmd == 'cmdAck'){
		if($("#iLiSLogoArea").attr("waitKey") != param){
			let p = {'wait':$("#iLiSLogoArea").attr("waitKey"), 'recv':param};
			globalFunction.send('ackError:'+JSON.stringify(p));
		}
//		if($("#iLiSLogoArea").attr("waitKey") == param){
			$("#iLiSLogoArea").attr("waitKey", "");
//		}
	}
	
	else if(cmd == 'recentCmdQue'){
		let obj;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}
		if(obj == null){
			$("#iLiSRecentCmdBtn").hide();
			return;
		}
		let w = '';
		if(obj.command == 'sendLink') w = 'URL受信中';
		else if(obj.command == 'sendText') w = 'テキスト受信中';
		else if(obj.command == 'quizStart' && obj.param && obj.param.quiz && obj.param.quiz.qType == 'enquete') w = '投票実施中';
		else if(obj.command == 'quizStart' && obj.param && obj.param.quiz && obj.param.quiz.qType == 'quiz') w = 'クイズ実施中';
		if(w != ''){
			$("#iLiSRecentCmdBtn").text(w);
			$("#iLiSRecentCmdBtn").attr("timeCode", obj.param.time);
			$("#iLiSRecentCmdBtn").show();
		}
	}
	
	else if(cmd == 'updateSetting'){
		iLiSNowSubject = {info:'科目情報読み込み中..'};
		if(iLiSDialog != undefined && iLiSDialog != null) iLiSDialog.close();
	}
	
	//オンラインユーザ数取得
	else if(cmd == 'onlineUserCount'){
		$("#onlineUserCountArea").text(param);
	}
	
	//科目と関係ないグローバルメッセージ
	else if(cmd == 'globalMessage'){
		let obj;
		try{
			obj = JSON.parse(param);
		}catch(e){
			return;
		}
		globalMessageView(obj);
	}
	


});

socket.addEventListener('error', (event) => {
  console.log('Websocket Connection エラー');
  console.log(event);
  WebSocketState = 0;
});

socket.addEventListener('close', (event) => {
  console.log('Websocket Connection 終了');
  WebSocketState = 0;
});

window.globalFunction.send = function(message){
	if(WebSocketState == 1){
		try{
			socket.send(message);
		}catch(e){
			console.log(e);
		}
	}
};

//HeatBeat(per 10Seconds)
setInterval(function(){
	//socketBeatSendTime = (new Date()).getTime();
	//socketBeatRecvTime = null;
	globalFunction.send("beat");
	setTimeout(function(){
		let now = (new Date()).getTime();
		if(socketLastRecvTime == null || now - socketLastRecvTime > 30000){
			console.log("connection lost");
			socket.refresh();
		}			
/*		
		if(socketBeatRecvTime == null){
			console.log("connection lost");
			socket.refresh();
		}
		else{
			console.log("connection time: " + (socketBeatRecvTime - socketBeatSendTime) + "ms");
		}
*/		
	}, 5000);
	
//	console.log(glexa.sessionStorage);
	
}, 10000);

function getHM(){
	let now = new Date();
	let hour = now.getHours();
	let minutes = now.getMinutes();
	let seconds = now.getSeconds();
	return (hour<10 ? '0'+hour : hour) + ':' + (minutes<10 ? '0'+minutes : minutes) + ':' + (seconds<10 ? '0'+seconds : seconds);
}

//リンクに見えるテキストをリンクにする
function autoLink(str) {
    var regexp_url = /((h?)(ttps?:\/\/[a-zA-Z0-9.\-_@:/~?%&;=+#',()*!]+))/g; // ']))/;
    var regexp_makeLink = function(all, url, h, href) {
        return '<a href="h' + href + '" target="_blank">' + url + '</a>';
    }
 
    return str.replace(regexp_url, regexp_makeLink);
}


function iLiSStudentTextView(obj, sendOK = false){
	let html = '<div>';
	html	+= '  <div class="text-center" style="margin-bottom:1em; border-bottom: solid 1px gray;">';
	html	+= '	<img src="/portal/img/iLiS/iLiS2.png" height="80" /><br/><br/>';
	html	+= '  </div>';
	html	+= '  <div>担当の先生からテキストが送られてきました。ボタンを押すとクリップボードにコピーされます</div><br/>';
	
//	html	+= '  <div style="text-align:left; white-space:pre-wrap; font-family:monospace; background-color:#eee; border:solid 1px gray; padding:10px; max-height:10em; overflow-y:scroll; font-weight:bold" id="iLiSRecvTextContent">';
//	html	+= escapeStr(obj.text);
//	html	+= '  </div>';
	
//	html	+= '  <textarea id="iLiSRecvTextContent" style="width:100%; height:10em; background-color:#eee" readonly="readonly">';
	html	+= '  <div id="iLiSRecvTextContent" style="width:100%; height:12em; max-height:15em; overflow-y:scroll; background-color:#eee; border:solid 1px gray; white-space:pre-wrap; padding:0.5em; text-align:left; user-select:text">';
	html	+= autoLink(escapeStrB(obj.text));
//	html	+= '  </textarea>';
	html	+= '  </div>';
	html	+= '  <div class="text-right" style="margin-top:1em; font-size:80%">※過去の受信テキストは科目ページから確認できます</div>';
	html	+= '</div>';
	html	+= '</div>';
	
	if(iLiSContentsDialog)
		iLiSContentsDialog.destroy();

	iLiSContentsDialog = new tingle.modal({
		footer: true,
		stickyFooter: false,
		closeMethods: ['overlay', 'button', 'escape'],
		closeLabel: "閉じる",
		onClose: function(){
			if(sendOK){
				let param = {command:'sendText', time:obj.time};
				globalFunction.send('recvOK:'+JSON.stringify(param));
			}
		}
	});
	
	iLiSContentsDialog.addFooterBtn('コピー', 'tingle-btn tingle-btn--primary', function() {
		//$("#iLiSRecvTextContent").select();
		//document.execCommand('copy');
		$(this).css("background-color", "green").text("コピー済");
		navigator.clipboard.writeText(obj.text);
	});
	
	iLiSContentsDialog.setContent(html);
	iLiSContentsDialog.open();
}

let mouseDown = false, wbound, stX, stY, penColor = 'black', baseImage;

function iLiSStudentQuizOpen(obj){
	iLiSOpenCommandTimeId = obj.time;
	
	let quiz = obj.quiz;
	let html = '<div>';
	html	+= '  <div class="text-center" style="margin-bottom:1em; border-bottom: solid 1px gray;">';
	html	+= '	<img src="/portal/img/iLiS/iLiS2.png" height="80" /><br/><br/>';
	html	+= '  </div>';
	w = quiz.qType == 'enquete' ? '投票' : 'クイズ';
	html	+= '  <div style="font-size:130%; font-weight:bold">'+w+'タイム！</div>';
	
	html	+= '  <fieldset class="text-left" id="iLiSQuestionArea" style="margin-top:1em; font-size:125%">';
	w = quiz.qType == 'enquete' ? '質問' : '問題';
	html	+= '	<legend>'+w+'</legend>';
	if(quiz.question == '') quiz.question = '('+w+'文なし)';
	html	+= '	<div style="white-space:pre-wrap; margin-left:1em">' + escapeStrB(quiz.question) + '</div>';
	html	+= '  </fieldset>';
	
	//単一選択・複数選択型
	if(quiz.aType == 'select' || quiz.aType == 'multi'){
		html+= '  <fieldset class="text-left" id="iLiSAnswerChoicesArea" class="text-center" style="margin-top:1em; font-size:125%">';
		w = (quiz.aType == 'select') ? '単一選択' : '複数選択';
		html+= '	<legend>選択肢('+w+')</legend>';
		html+= '	<div style="margin-left:1em; line-height:160%">';
		for(let i = 0; i < quiz.choices.length; i++){
			html+=	'	<div>';
			w = escapeStrB(quiz.choices[i]);
			if(quiz.aType == 'select'){
				let chk = obj.answer && obj.answer.answerChoices == i ? 'checked="checked"': '' ;
				html+=	'	<label><input type="radio" name="iLiSQuestionUserChoice" value="'+i+'" '+chk+' />' + w + '</label>';
			}
			else{
				let chk = obj.answer && obj.answer.answerChoices.includes(String(i)) ? 'checked="checked"': '' ;
				html+=	'	<label><input type="checkbox" name="iLiSQuestionUserChoice" value="'+i+'"/ '+chk+' >' + w + '</label>';
			}
			html+=	'	</div>';
		}
		html+= '	</div>';
		html+= '  </fieldset>';
	}

	//テキスト型
	else if(quiz.aType == 'text'){
		html+= '  <fieldset class="text-left" id="iLiSAnswerTextArea" class="text-center" style="margin-top:1em; font-size:125%">';
		html+= '	<legend>回答</legend>';
		html+= '	<div style="margin-left:1em">';
		w = obj.answer ? escapeStrB(obj.answer.answerText) : '';
		html+= '		<input class="form-control" type="text" name="iLiSQuestionUserText" style="width:100%" value="'+w+'" />';
		html+= '	</div>';
		html+= '  </fieldset>';
	}

	//お絵かき型
	else if(quiz.aType == 'image'){
		html+= '  <fieldset class="text-left" id="iLiSAnswerImageArea" class="text-center" style="margin-top:1em;">';
		html+= '	<legend>回答</legend>';
		html+= '	<div style="margin-left:0.5em">';
		html+= '			<div class="colorBox" style="background-color:black" color="black" onclick="changePenColor(\'black\');" ></div>';
		html+= '			<div class="colorBox" style="background-color:red" color="red" onclick="changePenColor(\'red\');" ></div>';
		html+= '			<div class="colorBox" style="background-color:blue" color="blue" onclick="changePenColor(\'blue\');" ></div>';
		html+= '			<div class="colorBox" style="background-color:white" color="white" onclick="changePenColor(\'white\');" ></div>';
		html+= '			<div class="colorBox" style="background-image:url(../portal/img/eraser.png); background-size: contain;" color="erase" onclick="changePenColor(\'erase\');" ></div><br/>';
		html+= '		<canvas style="border:solid 1px gray; max-width:100%" width="450" height="450" id="iLiSQuestionUserImage" />'
		html+= '	</div>';
		html+= '  </fieldset>';
	}
	
	html	+= '  <div style="width:100%">';
	w = obj.answer && obj.answer.anonymousFlag ? 'checked="checked"': '' ;
	html	+= '	<div style="float:left; margin-left:1em"><label><input type="checkbox" id="iLiSQuestionAnonymousChk" '+w+'>匿名で送る</label></div>';
	html	+= '	<div class="text-right" style="color:red; font-weight:bold; margin:0 0 -1.7em 0em" id="iLiSQuestionErrArea">&nbsp;</div>';
	html	+= '  </div>';
	html	+= '</div>';
	
	if(iLiSContentsDialog)
		iLiSContentsDialog.destroy();

	iLiSContentsDialog = new tingle.modal({
		footer: true,
		stickyFooter: false,
		closeMethods: ['overlay', 'button', 'escape'],
		closeLabel: "閉じる",
	});
	
	iLiSContentsDialog.addFooterBtn('回答送信', 'tingle-btn tingle-btn--primary', function() {
		$("#iLiSQuestionErrArea").html('&nbsp;');
		let choiceCnt = $("input[name='iLiSQuestionUserChoice']:checked").length;
		let textAnswer = $("input[name='iLiSQuestionUserText']").val();
		let anonymousFlag = $("#iLiSQuestionAnonymousChk").prop("checked")?1:0;
		if(textAnswer) textAnswer = textAnswer.trim();
		if(quiz.aType == 'select' && choiceCnt != 1){
			$("#iLiSQuestionErrArea").html('選択肢から1つだけ選択して下さい');
			return;
		}
		if(quiz.aType == 'multi' && choiceCnt < 1){
			$("#iLiSQuestionErrArea").html('選択肢から1つ以上選択して下さい');
			return;
		}
		if(quiz.aType == 'text' && textAnswer == ''){
			$("#iLiSQuestionErrArea").html('回答が入力されていません');
			return;
		}
		
		let ackKey = randomStr(10);
		let param = { quizId:quiz.id, tId:obj.tId, time:obj.time, ackKey:ackKey, anonymousFlag:anonymousFlag };
		if(quiz.aType == 'select'){
			param.answerChoices = $("input[name='iLiSQuestionUserChoice']:checked").val();
		}
		else if(quiz.aType == 'multi'){
			param.answerChoices = [];
			$("input[name='iLiSQuestionUserChoice']:checked").each(function(idx, elm){
				param.answerChoices.push($(elm).val());
			});
		}
		else if(quiz.aType == 'text'){
			param.answerText = textAnswer;
		}
		else if(quiz.aType == 'image'){
			const canvas = document.getElementById("iLiSQuestionUserImage");
			param.answerImage = canvas.toDataURL('image/jpeg', 0.7);
		}
		globalFunction.send('questionAnswer:'+JSON.stringify(param));
		iLiSAckWait(ackKey, {
			success: function(){
				iLiSContentsDialog.close();
			},
			error: function(){
				$("#iLiSQuestionErrArea").html('回答の送信に失敗しました。再度送信してください');
			}
		});	
	});
	
	iLiSContentsDialog.setContent(html);
	iLiSContentsDialog.open();	
	
	//お絵かき型の回答済み画像または下地画像反映・描画関連イベント登録
	if(quiz.aType == 'image'){
		const canvas = document.getElementById("iLiSQuestionUserImage");
		baseImage = new Image();
		baseImage.onload = function() {
			canvas.width = baseImage.width;
			canvas.height = baseImage.height;
			const context = canvas.getContext('2d');
			context.drawImage(baseImage, 0, 0);
		};
		if(obj.answer && obj.answer.answerImage){
			baseImage.src = obj.answer.answerImage;
		}
		else{
			baseImage.src = quiz.baseImage64;
		}

		canvas.addEventListener('mousedown', startDraw, false);
		canvas.addEventListener('mousemove', drawing, false);
		canvas.addEventListener('mouseup', endDraw, false);
		canvas.addEventListener('touchstart', startDraw, false);
		canvas.addEventListener('touchmove', drawing, false);
		canvas.addEventListener('touchend', endDraw, false);
		changePenColor('black');

		iLiSContentsDialog.checkOverflow();
	}
}

function iLiSStudentQuizResultView(obj){
	let scoreImageMap = {0:'batsu.png', 1:'sankaku.png', 2:'maru.png'};
	let quiz = obj.quiz;
	let html = '<style type="text/css">';
	html	+= '	.answerScoreView { background-position:top 8px right 8px; background-size:48px; background-repeat:no-repeat; background-color:rgba(255,255,255,0.4); background-blend-mode:lighten; }';
	html	+= '	img.answerImage { max-width:100%; max-height:320px; border:solid 1px black } ';
	html	+= '</style>';
	html	+= '<div>';
	html	+= '  <div class="text-center" style="margin-bottom:1em; border-bottom: solid 1px gray;">';
	html	+= '	<img src="/portal/img/iLiS/iLiS2.png" height="80" /><br/><br/>';
	html	+= '  </div>';
	w = quiz.qType == 'enquete' ? '投票' : 'クイズ';
	html	+= '  <div style="font-size:130%; font-weight:bold">'+w+'結果</div>';
	
	html	+= '  <fieldset class="text-left" id="iLiSQuestionArea" style="margin-top:1em; font-size:125%">';
	w = quiz.qType == 'enquete' ? '質問' : '問題';
	html	+= '	<legend>'+w+'</legend>';
	if(quiz.question == '') quiz.question = '('+w+'文なし)';
	html	+= '	<div style="white-space:pre-wrap; margin-left:1em">' + escapeStrB(quiz.question) + '</div>';
	html	+= '  </fieldset>';
	
	//採点結果用スタイル
	let scoreStyle = scoreImageMap[quiz.qType=='quiz'?obj.score:null];
	scoreStyle = scoreStyle ? 'background-image:url(/portal/img/'+scoreStyle+')' : '';
	
	//単一選択・複数選択型
	if(quiz.aType == 'select' || quiz.aType == 'multi'){
		html+= '  <fieldset class="text-left answerScoreView" id="iLiSAnswerChoicesArea" class="text-center" style="margin-top:1em; font-size:125%; '+scoreStyle+'">';
		w = (quiz.aType == 'select') ? '単一選択' : '複数選択';
		html+= '	<legend>選択肢 (' + (quiz.qType=='quiz'?'○＝正解　／ ':'') + '✓＝あなたの回答)</legend>';
		html+= '	<div style="margin-left:1em; line-height:160%">';
		for(let i = 0; i < quiz.choices.length; i++){
			w = obj.correctAnswer.choiceAnswerFlgs[i] ? 'color:blue; font-weight:bold' : '';
			html+=	'<div style="'+w+'">';
			if(quiz.qType == 'quiz'){
				html += '<div class="text-left" style="display:inline-block; width:1.5em; font-size:13pt">';
				html += obj.correctAnswer.choiceAnswerFlgs[i] ? '○' : '';
				html += '</div>';
			}
			html += '	<div class="text-left" style="display:inline-block; width:1.5em; font-size:13pt">';
			
			html += obj.answer && (quiz.aType == 'select' && obj.answer.answerChoices == i || quiz.aType == 'multi' && obj.answer.answerChoices.includes(String(i))) ? '✓' : '';
			html += '	</div>';
			html+=	escapeStrB(quiz.choices[i]);
			html+=	'</div>';
		}
		html+= '	</div>';
		html+= '  </fieldset>';
	}

	//テキスト型
	else if(quiz.aType == 'text'){
		if(quiz.qType == 'quiz'){
			w = '';
			$.each(obj.correctAnswer.textAnswers, function(idx, elm){
				if(w != '') w += '<span style="font-size:80%; font-weight:normal">&nbsp;&nbsp;または&nbsp;&nbsp;</span>';
				w += escapeStrB(elm);
			});
			html+= '  <fieldset class="text-left" style="margin-top:1em; font-size:125%; background-color:#dfd">';
			html+= '	<legend>正解例</legend>';
			html+= '	<div style="margin-left:1em">';
			html+= '		<div class="text-left" style="write-space:pre-wrap">' + w + '</div>';
			html+= '	</div>';
			html+= '  </fieldset>';
		}
		html+= '  <fieldset class="text-left answerScoreView" style="margin-top:1em; font-size:125%; '+scoreStyle+'">';
		html+= '	<legend>あなたの回答</legend>';
		html+= '	<div style="margin-left:1em; padding:0.5em 0;">';
		w = obj.answer ? escapeStrB(obj.answer.answerText) : '(未回答)';
		html+= '		<div class="text-left" style="write-space:pre-wrap">' + w + '</div>';
		html+= '	</div>';
		html+= '  </fieldset>';
	}

	//お絵かき型
	else if(quiz.aType == 'image'){
		html+= '<div class="text-left">';
		if(quiz.qType == 'quiz'){
			html+= '  <fieldset class="text-left" style="margin-top:1em; background-color:#dfd; display:inline-block;">';
			html+= '	<legend>正解例</legend>';
			html+= '	<div style="margin-left:0.5em; padding:0.5em;">';
			html+= '		<img class="answerImage" src="' + obj.correctAnswer.imageAnswer64 + '" />';
			html+= '	</div>';
			html+= '  </fieldset>';
		}
		html+= '  <fieldset class="text-left answerScoreView" style="background-size:24px; margin-top:1em; background-position:top right; display:inline-block; '+scoreStyle+'">';
		html+= '	<legend>あなたの回答</legend>';
		html+= '	<div style="margin-left:0.5em; padding:0.5em;">';
		w = obj.answer ? '<img class="answerImage" src="' + obj.answer.answerImage + '" />' : '(未回答)';
		html+= w;
		html+= '	</div>';
		html+= '  </fieldset>';
		html+= '</div>';
	}
	
	html	+= '</div>';
	
	if(iLiSContentsDialog)
		iLiSContentsDialog.destroy();

	iLiSContentsDialog = new tingle.modal({
		footer: true,
		stickyFooter: false,
		closeMethods: ['overlay', 'button', 'escape'],
		closeLabel: "閉じる",
		onClose: function(){
			//他のウィンドウの結果表示も(あれば)閉じるように通知
			globalFunction.send('closeAnswerResultView:'+obj.time);
		}
	});
	
	iLiSContentsDialog.addFooterBtn('閉じる', 'tingle-btn tingle-btn--primary', function() {
		iLiSContentsDialog.close();
	});
	
	iLiSContentsDialog.setContent(html);
	iLiSContentsDialog.open();
	let wTimer = setInterval(function(){
		let flag = true;
		$(".tingle-modal-box__content img").each(function(idx, elm){
			if(!$(elm)[0].complete) flag = false;
		});
		if(flag){
			iLiSContentsDialog.checkOverflow();
			clearInterval(wTimer);
		}
	}, 50);
}


function startDraw(event){
	event.preventDefault();

	const canvas = document.getElementById("iLiSQuestionUserImage");
	const zoom = canvas.width / canvas.clientWidth;
	const zoom2 = document.body.clientWidth / window.innerWidth;
	let px, py;
	if(event.changedTouches) {
//		console.log(event.touches[0]);
		px = event.changedTouches[0].pageX;
		py = event.changedTouches[0].pageY;
		let rect = canvas.getBoundingClientRect();
		px = rect.left + (px - rect.left) * zoom;
		py = rect.top + (py - rect.top) * zoom;
	}
	else{
		px = event.pageX;
		py = event.pageY;
	}
	
	// 描画前処理をおこないマウス押下状態にする。
	mouseDown = true;

	// クライアント領域からマウス開始位置座標を取得
	wbound = event.target.getBoundingClientRect() ;
	stX = px - wbound.left;
	stY = py - wbound.top;
	
	if(penColor == 'erase'){
		const context = canvas.getContext("2d");
		context.drawImage(baseImage,stX-10,stY-10,20,20,stX-10,stY-10,20,20);
	}
}

function drawing(event){
	event.preventDefault();

	const canvas = document.getElementById("iLiSQuestionUserImage");
	const zoom = canvas.width / canvas.clientWidth;
	const zoom2 = document.body.clientWidth / window.innerWidth;
	let px, py;
	if(event.changedTouches) {
//		console.log(event.touches[0]);
		px = event.changedTouches[0].pageX;
		py = event.changedTouches[0].pageY;
		let rect = canvas.getBoundingClientRect();
		px = rect.left + (px - rect.left) * zoom;
		py = rect.top + (py - rect.top) * zoom;
	}
	else{
		px = event.pageX;
		py = event.pageY;
	}

	// マウスボタンが押されていれば描画中と判断
	if (mouseDown){
		x = px - wbound.left;
		y = py - wbound.top;
		draw(x, y);
	}
}

function endDraw(event){
	event.preventDefault();

	// マウスボタンが押されていれば描画中と判断
	if (mouseDown){
		const canvas = document.getElementById("iLiSQuestionUserImage");
		const context = canvas.getContext("2d");
		context.globalCompositeOperation = 'source-over';
		context.setLineDash([]);
		mouseDown = false;
	}
}

function draw(x, y){
	const canvas = document.getElementById("iLiSQuestionUserImage");
	const context = canvas.getContext("2d");
	if(penColor == 'erase'){
		context.drawImage(baseImage,stX-10,stY-10,20,20,stX-10,stY-10,20,20);
	}
	else{
		context.beginPath();
		context.strokeStyle = penColor;
		context.fillStyle = penColor;
		context.lineWidth = 3;
		context.lineCap = "round";

		context.globalCompositeOperation = 'source-over';
		context.moveTo(stX,stY);
		context.lineTo(x,y);
		context.stroke();
	}
	stX = x;
	stY = y;
}

function changePenColor(color){
	penColor = color;
	$(".colorBox").css("border", "solid 1px black");
	$(".colorBox[color='"+penColor+"']").css("border", "solid 3px orange");
}

	

function globalMessageView(obj){
//	console.log(obj.message);
	var html = '<div style="white-space:pre-wrap">' + obj.message + '</div>';
	glexa.openCommonAlertModal({title:"システムからのお知らせ", body:html, onOk:function(){ glexa.closeCommonAlertModal(); }} );
}

