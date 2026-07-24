var schoolCode = '';
var useTinyQuiz = 0;

$(function(){
	//ポータルへのログイン失敗で飛ばされてきた時はポータルのログインページにジャンプ
	if(document.referrer.indexOf("/portal/login.php") > 0 && document.location.href.indexOf("/lms/password/reminder/") == -1){
		$.get("/portal/lmsinc/checkRequireChange.php", function(res){
			if(!res || !res.is_required_change){
				document.body.style.display = "hidden";
				location.href = "/portal/login.php?type=error";
				return;
			}
		});
		return;
	}

	//PWAで実行されているか確認
	if(window.matchMedia('(display-mode: standalone)').matches){
		let pwaToken = window.localStorage.getItem('pwaToken');
		// $("#div-login-form").after("<div class='text-center'>##" + pwaToken + "##</div>");

		//ログインページかつpwaTokenが存在していたらだったら認証チェックページにリダイレクト
		if($("#div-login-form").length > 0 && pwaToken){
			$("body").hide();
			location.href = "/portal/lmsinc/pwaAuthCheck.php";
			return;
		}
	}

	//学園ポータルリンクを追加
	$("ul.navbar-right:first li").before('<li style="margin-right:3px"><a href="/portal/index.php" class="btn btn-black btn-sm logout" style="background-color:green" id="toportal">iポータルへ</a></li>');

	// 健康観察向けリンクを追加 → 未入力のみに変更
	if(schoolCode == '99'){ // delete 2025.8.22
		$.get("/portal/api/healthApi.php?type=getstudentrecord", function(resjson){
			const res = JSON.parse(resjson);
			if(!res || !res['success'] || !res['students'] || !res['students']['sId']){
				$("#toportal").parent().after('<li style="margin-right:3px" id="liinputbodytempe"><a class="btn btn-black btn-sm logout" style="background-color:darkturquoise" id="inputbodytempe" onclick="healthInputForm();">健康状態入力</a></li>');
			}
		});
	}

	//マイページリンクのリンク先を差し替え(元のページは重すぎるため)
	$("#header-menu .gnav li a[href='/lms/mypage/']").attr("href", "/portal/lmsinc/sMyPage.php");

	//未読お知らせバッジ
	$.get("/portal/api/portalApi.php?type=newinfocnt", function(res){
		if(res.cnt>0)
			$("#toportal").append('<span class="badge badge-danger" style="background-color:red; display: inline-block;">'+res.cnt+'</span>');
	});

	//ヘッダにモーダル表示ライブラリのリンクを追加
	var style = '<script src="/portal/lmsinc/tingle.min.js"></script><link rel="stylesheet" href="/portal/lmsinc/tingle.min.css">';
	style += '<link rel="stylesheet" href="/portal/iLiS/style.css?v=2">';
	style += '<script src="/portal/lmsinc/jquery.cookie.min.js"></script>';
	style += '<script src="/portal/lmsinc/reconnecting-websocket.min.js"></script>';
	style += '<script src="/portal/lmsinc/websocketJS.php"></script>';
    $('head link:last').after(style);

	// countdown to graduation ceremony
//	const cddate = Math.ceil((Date.parse("2022/3/14") - Date.now()) / (24 * 60 * 60 * 1000));
//	if(($(".navbar-header").length > 0) && (cddate >= 0) && (cddate < 51)){
//
//		// modal image area
//		$("<div>").attr("id", "divimgarea").css("position", "fixed").css("top", "0").css("left", "0").css("width", "100%").css("height", "100%").css("backgroundColor", "rgba(0, 0, 0, 0.7)").css("opacity", "0").css("zIndex", "-1").click(function(){
//			$("#largeimg").attr("src", "data:image/gif;base64,R0lGODlhAQABAGAAACH5BAEKAP8ALAAAAAABAAEAAAgEAP8FBAA7");
//			$("#divimgarea").css("opacity", "0");
//			$("#divimgarea").css("zIndex", "-1");
//			$("#divimgarea").css("transition", "opacity 0s");
//		}).appendTo("body");
//		$("<div>").attr("id", "divimage").css("display", "flex").css("width", "100%").css("height", "100%").css("justifyContent", "center").css("alignItems", "center").appendTo("#divimgarea");
//		$("<div>").attr("id", "imggroupn").css("textAlign", "center").appendTo("#divimage");
//		$("<img>").attr("id", "largeimg").appendTo("#imggroupn");
//		$("<div>").attr("id", "closetext").css("fontSize", "1.2rem").css("textShadow", "2px 0px 3px #fff, 0px 2px 3px #fff, -2px 0px 3px #fff, 0px -2px 3px #fff").text("クリックすると閉じます").appendTo("#imggroupn");
//		$("<img>").attr("id", "cdimglarge").css("display", "none").appendTo("body");
//
//		// head small image
//		$("<div>").attr("id", "grdcd").css("float", "left").css("textAlign", "center").css("padding", "1px").appendTo(".navbar-header");
//		if(cddate != 0){
//			$("<div>").attr("id", "grcdl0").css("fontSize","10px").text("卒業式まで").appendTo("#grdcd");
//			$("<div>").attr("id", "grcdl1").css("fontSize","13px").text("あと").appendTo("#grdcd");
//			$("<div>").attr("id", "grcdl2").css("fontSize","10px").css("color", "darkgray").css("paddingTop", "1px").appendTo("#grdcd");
//		}
//		$("<div>").attr("id", "divgdimg").css("position","relative").css("float", "left").css("cursor", "pointer").click(function(e){
//			e.stopPropagation();
//			e.preventDefault();
//			if(cddate == 0){
//				window.open("https://iwasaki-event.com/sotsugyou2022/", '_blank');
//			} else {
//				const objc = document.getElementById("cdimglarge");
//				const bgw90 = $("#divimgarea").width() * 0.9;
//				const bgh90 = $("#divimgarea").height() * 0.9;
//				if((objc.naturalWidth <= bgw90) && (objc.naturalHeight <= bgh90)){
//					$("#largeimg").width(objc.naturalWidth);
//					$("#largeimg").height(objc.naturalHeight);
//				} else if((objc.naturalWidth / bgw90) > (objc.naturalHeight / bgh90)){
//					$("#largeimg").width(bgw90);
//					$("#largeimg").height(objc.naturalHeight / (objc.naturalWidth / bgw90));
//				} else {
//					$("#largeimg").width(objc.naturalWidth / (objc.naturalHeight / bgh90));
//					$("#largeimg").height(bgh90);
//				}
//				$("#largeimg").attr("src", objc.src);
//				$("#divimgarea").css("opacity", "1");
//				$("#divimgarea").css("zIndex", "3000");
//				$("#divimgarea").css("transition", "opacity 0.5s");
//			}
//		}).appendTo(".navbar-header");
//		$("<img>").attr("id", "cdimg").height("50px").css("border", "0").css("padding", "1px").appendTo("#divgdimg");
//
//		var gdfile = new XMLHttpRequest();
//		gdfile.open("GET", "/portal/lmsinc/getGraduationPhoto.php?mode=check", true);
//		gdfile.send(null);
//		gdfile.onload = function(){
//			gfi = gdfile.responseText.split(",");
//			if((gfi.length == 2) && (gfi[0] != "none")){
//				$("#grcdl2").text(gfi[0]);
//				$("#cdimg").attr("src", "/portal/lmsinc/getGraduationPhoto.php?mode=showtn");
//				$("#cdimglarge").attr("src", "/portal/lmsinc/getGraduationPhoto.php?mode=show");
//			} else {
//				$("#grdcd").css("display", "none");
//				$("#divgdimg").css("display", "none");
//			}
//		}
//	}

	//クラス(科目)ページのトップかつ学生の場合
	if(document.location.href.indexOf("/lms/class/") > 0){
		var words = document.location.href.split('/');
		var classId = '0';
		for(i = 0; i < words.length; i++){
			if(words[i] == 'class') classId = words[i+1];
		}

		if(typeof window.globalFunction != 'undefined' && typeof window.globalFunction.send == 'function'){
			setTimeout(function(){
				window.globalFunction.send("view s " + classId);
			},2000);
		}

		var timer4 = setInterval(
			function(){
				if(glexa.sessionStorage.getItem('directory_id') == 0){
					if($("#lessonLists").length == 0){
						var html = '<div class="panel panel-default sp-margin-bottom-none sp-border-bottom-none" id="lessonLists">';
						html +=    '  <div class="panel-heading cf"><i class="mark"></i>時間割</div><div class="panel-body">※調整中</div>';
						html +=    '</div>';
						$("#div-class-syllabuses").after(html);

						$("#lessonLists div:eq(1)").load("/portal/lmsinc/getLessonList.php?classId="+escapeStr(classId));
					}
				}
				else{
					$("#lessonLists").remove();
				}
			}
			,500
		);

		var lrfCheckClassDate = false;
		//var lrfClassInfo = []; // include homeroom teacher, class teacher, office clerk
		var timer5 = setInterval(
			function(){
				var directoryId = glexa.sessionStorage.getItem('directory_id');
				var links = $(".table-class-content .x-drag-title > a:not([flag])");
				var cnt = links.length;
				for(i = 0; i < cnt; i++){
					$(links[i]).attr("flag", "1");
					if($(links[i]).attr("href").startsWith("http")){
						$(links[i]).attr("onclick", "openLinkRecord('"+classId+"','"+directoryId+"','"+$(links[i]).attr("href")+"')");
					}
				}

				//出席確認を有効化(YDA以外)
				if(classId>=2920 && schoolCode != '21'){
					if($("#checkEntryBtn").length == 0)
						$(".class-submenu").prepend('<button class="btn btn-sm btn-info" style="font-weight:bold; margin:-4px 2em" id="checkEntryBtn" onclick="checkAttendEntry('+classId+');">出席確認</button>');

					//出席確認のコード入力で Enterキーを押したら送信
					if($("#form-entry input[name='code']").length > 0 && !$("#form-entry input[name='code']").attr("flag")){
						//console.log("event on");
						$("#form-entry input[name='code']").attr("flag", "1");
						$("#form-entry input[name='code']").focus();
						$("#form-entry input[name='code']").keypress(function(e) {
							if(e.keyCode == 13) {
								$('.button-send-entry').trigger('click');
							}
						});
					}

					if(lrfCheckClassDate == false && $("#postLateFormBtn").length == 0){
					if(schoolCode == '12' || classId == 4246){
						if($('ul').hasClass('class-submenu')){
							lrfCheckClassDate = true;
							// get use late report form or not
							$.get("/portal/lmsinc/portalDBUtil.php?type=gettimetablefromclassid&classid="+classId, function(res){
							//console.log(res);
								if(res.rows && res.rows.length > 0){
									lrfClassInfo = res.rows;
						 			$(".class-submenu").prepend('<button class="btn btn-sm btn-info" style="font-weight:bold; margin:-4px 0.1em; background-color: #ff00ff;" onMouseOver="this.style.setProperty(\'background-color\', \'#dd00dd\', \'important\')" onFocus="this.style.setProperty(\'background-color\', \'#dd00dd\', \'important\')" onMouseOut="this.style.backgroundColor=\'#ff00ff\'" id="postLateFormBtn" onclick="postLateFormEntry('+classId+');">遅延証明</button>');
									// make date list
								}
							});
						}
					} else {
						lrfCheckClassDate = true;
					}
					}
				}

				//iLiSコンテンツ
				if($("#div-class-contents > .panel > .panel-heading").length > 0 && !$("#div-class-contents > .panel > .panel-heading").attr("iLiSFlag")){
					$("#div-class-contents > .panel > .panel-heading").attr("iLiSFlag", 1);
					if(directoryId == 0)
						$("#div-class-ilis-contents").hide();
					else
						viewILiSContents(classId, directoryId);
				}

				//Slack質問チャンネルへのリンク・Quiz高速版対応確認
				if($("#class-menu").length != 0){
					if(!$("#class-menu").attr("slackFlg") && $(".user-icon").length > 0){
						$("#class-menu").attr("slackFlg", 1);
						$.get("/portal/lmsinc/portalDBUtil.php?type=issalesforcelinkclasswithslack&classId="+classId, function(res){
//							console.log(res);
							if(res.isNowClass == 1 && res.slackUseFlag == 1 && res.slackSettings && res.slackSettings.studentsChannelId){
								$("#class-menu").append('<li><a href="slack://channel?team='+res.studyLogWorkspaceId+'&id='+res.slackSettings.studentsChannelId+'"><img src="/portal/img/slackIcon.png" alt="" class="icon">質問</a></li>');
							}
							useTinyQuiz = res.useTinyQuiz;
						});
					}
				}

				//SwipeVideo埋め込み対応
				$(".table-class-content div.cf:not([svChkFlg='1'])").each(function(idx, elm){
					$(elm).attr("svChkFlg", 1);
					let content = $(elm).text().trim();
					if(content.startsWith('<script src="https://swipevideo.site/libs/embedcdn.js">')){
						$(elm).html(content);
						$(elm).find(".sv-embed").css("max-width","40em");
						let contentId = $(elm).find(".sv-embed").data("cid");
						$(elm).find(".sv-embed").off().on("mousedown touchstart", function(){
							$.get("/portal/api/portalApi.php?type=action&t=swipeVideo&p1="+contentId, function(){});
						});
					}
				});

/*
				//Quiz高速版テスト
				$("div.confirm > div > a[href^='/lms/content/']").each(function(idx, elm){
					if($(elm).attr("chk") == '1') return;
					$(elm).attr("chk", '1');
					let href = $(elm).attr('href');
					let contentId = href.split('/')[3];

					//TODO: コンテンツの内容をチェック
					if(contentId == 204522 || contentId == 202369){
						console.log(contentId);
						$(elm).text("受講(#)");
						$(elm).attr('href', '/portal/lmsinc/quizTiny.php?id='+contentId);
						$(elm).after('<span><a href="'+href+'">.</a></span>');
					}
				});
*/
				//Quiz高速版( 科目として有効な場合のみ )
				if(useTinyQuiz && false){
					$("div.confirm > div > a[href^='/lms/content/']").each(function(idx, elm){
						if($(elm).attr("chk") == '1') return;
						$(elm).attr("chk", '1');
						let href = $(elm).attr('href');
						let contentId = href.split('/')[3];
//						console.log(contentId);

						//コンテンツが高速版に対応しているか確認( コンテンツ名の最後が#の場合は強制非対応 )
						$.get("/portal/lmsinc/getGlexaDBUtil.php?type=quiztinysupportcheck&id="+contentId, function(res){
							if(res.support){
								$(elm).text("確認(#)");
								$(elm).attr('href', '/portal/lmsinc/quizTiny.php?id='+contentId);
//								$(elm).after('<span><a href="'+href+'">.</a></span>');
							}
						});
					});
				}

				//ファイルダウンロード分離テスト
				$("tbody.tbody-content-sort > tr div > a[href^='/lms/file/'][target='_blank']").each(function(idx, elm){
					if($(elm).attr("chk") == '1') return;
					$(elm).attr("chk", '1');
//					console.log(elm);
					let fileName = $(elm).text();
					let fileExt = fileName.split('.').pop().toLowerCase();
					//動画の場合は変換しない
					if(fileExt == 'mp4' || fileExt == 'mov' || fileExt == 'avi' || fileExt == 'mp3' || fileExt == 'm4a'){
						return;
					}
					let href = $(elm).attr('href');
					let fileKey = href.split('/')[3];
					$(elm).attr('href', '/portal/lmsinc/gxFileView.php?classId='+classId+'&fileKey='+fileKey);
					$(elm).after('<span><a href="'+href+'" target="_blank">.</a></span>');
				});
			}
			,150
		);

//		var timer51 = setInterval(
//			function(){
//				if($("#div-class-syllabuses").length > 0){
//					$("#div-class-syllabuses").remove();
//					clearInterval(timer51);
//				}
//			}
//			,200
//		);

		//let t53cnt = 0; // ディレクトリ間の移動では再読み込みが発生しないため削除
		let curDirId = -1; // for first time
		var timer53 = setInterval(
			async function(){
				const contenttable = document.querySelector('table.table-class-content');
				if(!contenttable) return;

				const contentsDiv = document.querySelector('#div-class-contents');
				if(!contentsDiv || contentsDiv.attributes.length < 2) return;
				const dummyattr = contentsDiv.attributes[1]; // don't know why
				const dirId = contentsDiv?.getAttribute('directory_id') || null;

				// directory is not changed
				if(dirId == null || curDirId == dirId){
					return;
				}

				// root directory
				if(dirId == "0"){
					//t53cnt++;
					//if(t53cnt > 6){
					//	clearInterval(timer53);
					//}
					curDirId = "0";
					return;
				}
				curDirId = dirId;
				//console.log(dirId);

				// get max score point
				const scoreresponse = await fetch('/portal/lmsinc/getGlexaDBUtil.php?type=quizscoresbydirectoryid', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						dId: dirId
					})
				});
				const dscoreret = await scoreresponse.json();
				const dscores = dscoreret?.rows;

				//console.log("dscores");
				//console.log(dscores);
				const studyline = contenttable.querySelectorAll('tbody tr');
				let needmore = false;
				for(const scont of studyline){
					const qcell = scont.querySelectorAll('td');
					if(qcell.length < 4) continue;
					const qzatag = qcell[1].querySelector('div > div > b > a');
					if(!qzatag) continue;
					const contId = qzatag.getAttribute('content_id') || null;
					if(!contId) continue;
					const maxscore = dscores.find(esc => esc.content_id == contId);
					if(maxscore == undefined) continue;

					const mparea = document.getElementById(contId + "point");
					if(!mparea && (maxscore.title.startsWith('(K)') || maxscore.title.startsWith('(D)') || maxscore.title.startsWith('(H)'))){
						const pointarea = qcell[3];
						const pointdiv = document.createElement('div');
						pointdiv.id = contId + "point";
						pointdiv.style.fontSize = "10px";
						if(maxscore.title.startsWith('(H)')){
							if(needmore){
								const levelgage = pointarea.querySelector('div');
								const ptpercent = pointarea.querySelector('small');
								if(levelgage) levelgage.style.display = "none";
								if(ptpercent) ptpercent.style.display = "none";
								if(maxscore.maxpoint){
									//pointdiv.textContent = "最高得点 " + maxscore.maxpoint + "点";
									pointdiv.innerHTML = "最高得点 " + maxscore.maxpoint + "点<br>";
								}
								if(maxscore.maxpoint && maxscore.maxpoint == 100){
									pointdiv.innerHTML += "完了";
								} else {
									pointdiv.innerHTML += "未完了";
								}
							}
						} else {
							if(maxscore.maxpoint){
								pointdiv.textContent = "最高得点 " + maxscore.maxpoint + "点";
							} else {
								pointdiv.textContent = "未完了";
							}
							if(maxscore.title.startsWith('(D)') && maxscore.maxpoint < 60){
								needmore = true;
							}
						}
						pointarea.appendChild(pointdiv);
					}
				}
				// clearInterval(timer53);
			}
			,330
		);

	}

	//トップページの場合、カレンダーを差し替え
	if($("#div-top-timetable").length != 0){
		//カレンダーの差し替え
		$("#div-top-timetable").css("display", "none");
		$("#div-top-timetable").after('<div id="div-top-timetable2"></div>');
		//カレンダーロード関数を上書き
		glexa.loadTopTimetable = function(archiveId, thisWeekFirstDay) {
			if(thisWeekFirstDay){
				$.get("/portal/api/portalApi.php?type=gettimetablesetting&nid="+$(".user-icon").text().substr(0,11), function(res){
					const dows = ['日', '月', '火', '水', '木', '金', '土'];
					if(res.result && res.result == "success" && res.set){

						// to get timetable show options
						// remove 1day shift button
						$(".before-one-day-btn").css("display", "none");
						$(".after-one-day-btn").css("display", "none");

						const ttsmode = res.set;
						const nstartd = $(".week-data:eq(0) a").attr("href");
						const tgtstd = nstartd.split('/').at(-1);
						const ntoday = new Date();
						let tgtstdd = new Date(tgtstd);
						
						/*
						時間割の曜日の始まりを編集できるようにし、デフォルトの並びと一致していない場合にスケジュールをずらす処理になっている
						しかし、ずれていない場合の処理が書かれていないため、デフォルトではスケジュールを表示できない
						例）timetable_(+スタログID)が1の時、tgtstddが月曜日の場合にgetScheduleCalendar.phpを呼び出さない
						if文内でtgtstddの日付を修正しているので、それ以降の処理は共通しているのではないか？
						*/
						if(tgtstdd.getDay() != ttsmode){
							let shiftd = tgtstdd.getDay() - ttsmode;
							if(shiftd < 0) shiftd += 7;
							tgtstdd.setDate(tgtstdd.getDate() - shiftd);
						}
						
						const ttstartdate = tgtstdd.toLocaleDateString('sv-SE');
						let cvd = new Date(ttstartdate);
						for(let dn = 0; dn < 7; dn++){
							// change date
							let cellhtml = (cvd.getMonth() + 1) + "/" + cvd.getDate()  + "（" + dows[cvd.getDay()] + "）";
							cellhtml += '<a href="/lms/schedule/form/0/' + cvd.getFullYear() + '-' + (cvd.getMonth() + 1).toString().padStart(2, "0") + '-' + cvd.getDate().toString().padStart(2, "0") + '"><i class="fas fa-edit"></i></a>';
							$(".week-data").eq(dn).html(cellhtml);
							// check today
							if(cvd.toDateString() === ntoday.toDateString()){
								$(".week-data").eq(dn).css("font-weight", "bold");
							} else {
								$(".week-data").eq(dn).css("font-weight", "normal");
							}
							// remove class
							$(".week-data").eq(dn).removeClass('week-data-sat');
							$(".week-data").eq(dn).removeClass('week-data-sun');
							let anchortt = '時間割を' + dows[cvd.getDay()] + '曜日始まりで固定する';
							let anchoropacity = "0.3";
							let modeclick = cvd.getDay();
							if(ttsmode == cvd.getDay()){
								anchortt = '時間割の' + dows[cvd.getDay()] + '曜日始まりを解除する';
								anchoropacity = "1";
								modeclick = "off";
							}
							if(cvd.getDay() == 0){
								$(".week-data").eq(dn).addClass('week-data-sun');
								$(".week-data").eq(dn).append('<div style="display: inline-block; float: right; clear: both; width: 0px;" title="' + anchortt +  '"><img class="ttmodeanchor" src="/lms/common/images/icons/clip.png" style="position: relative; left: -15px; cursor:pointer; opacity: ' + anchoropacity + ';" onclick="ttshowset(this, \'' + modeclick + '\');"></div>');
							} else if(cvd.getDay() == 1){
								$(".week-data").eq(dn).append('<div style="display: inline-block; float: right; clear: both; width: 0px;" title="' + anchortt + '"><img class="ttmodeanchor" src="/lms/common/images/icons/clip.png" style="position: relative; left: -15px; cursor: pointer; opacity: ' + anchoropacity + ';" onclick="ttshowset(this, \'' + modeclick + '\');"></div>');
							} else if(cvd.getDay() == 6){
								$(".week-data").eq(dn).addClass('week-data-sat');
							}

							$(".week-data-content").eq(dn).attr('date', cvd.getFullYear() + '-' + (cvd.getMonth() + 1).toString().padStart(2, "0") + '-' + cvd.getDate().toString().padStart(2, "0"));

							cvd.setDate(cvd.getDate() + 1);
						}
						$("#div-top-timetable2").load("/portal/lmsinc/getScheduleCalendar.php?startDate="+ttstartdate , () => applyIwafesBackground());
					} else {
						
						$("#div-top-timetable2").load("/portal/lmsinc/getScheduleCalendar.php?startDate="+thisWeekFirstDay, () => applyIwafesBackground());
						// add anchor
						let cvd = new Date($(".week-data:eq(0) a").attr("href").split('/').at(-1));
						for(let dn = 0; dn < 7; dn++){
							let anchortt = '時間割を' + dows[cvd.getDay()] + '曜日始まりで固定する';
							let anchoropacity = "0.3";
							let modeclick = cvd.getDay();
							if(cvd.getDay() == 0 || cvd.getDay() == 1){
								$(".week-data").eq(dn).append('<div style="display: inline-block; float: right; clear: both; width: 0px;" title="' + anchortt +  '"><img class="ttmodeanchor" src="/lms/common/images/icons/clip.png" style="position: relative; left: -15px; cursor:pointer; opacity: ' + anchoropacity + ';" onclick="ttshowset(this, \'' + modeclick + '\');"></div>');
							}
							cvd.setDate(cvd.getDate() + 1);
						}
					}
				}).done(function(rdata) {

				//就職活動予定表示
				var s = $(".week-shedule-content > .week-data-content:first").attr("date");
				var e = $(".week-shedule-content > .week-data-content:last").attr("date");
				$.get("/portal/api/recruitApi.php?type=jobhunthistoriesbyuserondaterange&startDate="+s+"&endDate="+e, function(res){
					if(res && res.rows){
						for(var i = 0; i < res.rows.length; i++){
							var row = res.rows[i];
							var html = '<div style="margin-bottom:0.5em">';
							if(row.activityTime) html += '<span>'+row.activityTime.substr(0,5)+' ~ </span><br>';
							//その他の就職活動の場合
							if(row.groupNo == 0){
								html += '<span class="glyphicon glyphicon-bell" style="color:green" aria-hidden="true"></span><span class="green top-schedule-title"><a href="/portal/jobhuntManage.php?openId='+row.id+'&type=other" target="_blank">' + escapeStr(row.otherActivityTypeStr) + '<br/><div style="margin-left:1.7em">@' + escapeStr(row.place) + '</div></a></span>';
							}
							//企業に対する就職活動の場合
							else{
								html += '<span class="glyphicon glyphicon-calendar" style="color:green" aria-hidden="true"></span><span class="green top-schedule-title"><a href="/portal/jobhuntManage.php?openId='+row.id+'" target="_blank">' + escapeStr(row.clientName) + '<br/><div style="margin-left:1.7em">(' + escapeStr(row.activitiesText) + ')</div></a></span>';
							}
							html += '</div>';
							$(".week-shedule-content > .week-data-content[date='"+res.rows[i].activityDate+"']").append(html);
						}
					}
				});

				//キャリアカフェスケジュール
				$.get("/portal/api/portalApi.php?type=meetingschedule&start="+s+"&end="+e, function(res){
//					console.log(res);
					if(res.rows){
						for(let i = 0; i < res.rows.length; i++){
							let html = '';
							let row = res.rows[i];
							let date = row.start_at.substr(0, 10);
							let sTime = row.start_at.substr(11, 5);
							let eTime = row.end_at.substr(11, 5);
							html += '<span class="glyphicon glyphicon-user" style="color:blue" aria-hidden="true"></span><span class="blue top-schedule-title"><a href="'+row.detail_counsel_reserve_url+'" target="_blank">'+sTime+'～'+eTime+'<br/><div style="margin-left:1.7em">'+escapeStr(row.purpose)+'</div></a></span>';
							$(".week-shedule-content > .week-data-content[date='"+date+"']").append(html);
						}
					}
				});


				$.get("/career/api/events/student?start="+s+"&end="+e, function(res){
					if(!Array.isArray(res)) return;
					for(let i = 0; i < res.length; i++){
						let html = '';
						let row = res[i];
						let date = row.event_start_at.substr(0, 10);
						let sTime = row.event_start_at.substr(11, 5);
						let eTime = row.event_end_at.substr(11, 5);
						let url = "/career/events/" + row.event_id;
						html += '<span class="glyphicon glyphicon-comment" style="color:blue" aria-hidden="true"></span><span class="blue top-schedule-title"><a href="'+url+'" target="_blank">'+sTime+'～'+eTime+'<br/><div style="margin-left:1.7em">'+escapeStr(row.title)+'</div></a></span>';
						$(".week-shedule-content > .week-data-content[date='"+date+"']").append(html);
					}
				});

				if($(".user-icon").text().substr(4,2) == '12' || $(".user-icon").text().substr(4,2) == '13'){
					let c = '<span class="glyphicon glyphicon-comment" style="color:blue" aria-hidden="true"></span><span class="blue top-schedule-title"><a href="https://portal.iwasaki.ac.jp/portal/eventList.php?eventCode=95" target="_blank">14:40～15:40<br/><div style="margin-left:1.7em">【希望者のみ】エンジニア向け特別セミナー</div></a></span>';
					$(".week-shedule-content > .week-data-content[date='2022-11-04']").append(c);
				}
				});

			}
		}

		//追加案内情報を埋め込み
		$.get("/portal/lmsinc/topInformation.php", function(res){
			$(".panel-default:first").before(res);
		});

		var timer11 = setInterval(
			function(){
				clearInterval(timer11);
				if($(".classes-student-view .list-group-item").length > 0){
					$(".classes-student-view").append('<div class="text-right" style="margin:5px 0.5em 5px 5px">※終了科目は「マイページ」から閲覧</div>');
				}
			}
		,500);
	}

	// 管理者への問い合わせ
	if(document.location.href.indexOf("/lms/contact/") > 0){
		if($(".margin-top-lg").length > 1){
			$(".margin-top-lg:eq(1)").html("※ 問い合わせ内容には氏名と返信先のメールアドレスを必ず記入してください<br>※ 特定の科目だけが表示されないなど、システムの問題についての問い合わせ先です<br>※ 授業や課題などの質問については授業担当か担任に相談ください");
		}
	}

	//マイページの場合、課題状況タブを追加
	if(document.location.href.indexOf("/lms/mypage/") > 0 || document.location.href.indexOf("sMyPage.php") > 0){
		var timer52 = setInterval(
			function(){
				if($(".nav-tabs").length > 0 && $("#div-mypage-tab").text().trim() != ''){
					//独自ページを埋め込むための関数
					var loadExtendPage = function(page){
						glexa.loadingOverlay=getBusyOverlay("viewport",{color:'black',opacity:0.1,text:'loading',style:'text-decoration:blink;font-weight:bold;font-size:12px;color:white;z-index:9999'},{color:'#666',size:100,type:'c'});

						$.get("/portal/lmsinc/"+page+".php", function(res){
							$("#div-mypage-tab").html(res);
							if(glexa.loadingOverlay) glexa.loadingOverlay.remove();
						});
					};

					//「活動フォーム」タブと「利用状況」タブを削除
					$(".nav-tabs .li-tabs:eq(1)").remove();
					$(".nav-tabs .li-tabs:eq(2)").remove();

					//「履修状況」タブを追加
					$(".nav-tabs .li-tabs:eq(0)").before('<li class="li-tabs"><a href="#status" class="a-mypage-tab1">履修状況</a></li>');
					$('.a-mypage-tab1').off('click');
					$('.a-mypage-tab1').on('click', function(e) {
						e.preventDefault();
						var hash = $(this).attr('href').replace('#', '');
						location.hash = hash;
						$('.li-tabs').removeClass('active');
						$(this).closest('li').addClass('active');
						loadExtendPage('mySubjectStatus');
					});

					//「課題提出状況」タブを追加
					$(".nav-tabs .li-tabs:eq(0)").after('<li class="li-tabs"><a href="#report" class="a-mypage-tab2">課題提出状況</a></li>');
					$('.a-mypage-tab2').off('click');
					$('.a-mypage-tab2').on('click', function(e) {
						e.preventDefault();
						var hash = $(this).attr('href').replace('#', '');
						location.hash = hash;
						$('.li-tabs').removeClass('active');
						$(this).closest('li').addClass('active');
						loadExtendPage('myReportStatus');
					});

					//「出欠状況」タブを追加
					$(".nav-tabs .li-tabs:eq(1)").after('<li class="li-tabs" id="litabattend"><a href="#attend" class="a-mypage-tab3">出欠状況</a></li>');
					$('.a-mypage-tab3').off('click');
					$('.a-mypage-tab3').on('click', function(e) {
						e.preventDefault();
						var hash = $(this).attr('href').replace('#', '');
						location.hash = hash;
						$('.li-tabs').removeClass('active');
						$(this).closest('li').addClass('active');
						loadExtendPage('myAttendStatus');
					});

					//「健康観察状況」タブを追加
					//if(schoolCode == '11' || schoolCode == '12' || schoolCode == '23'){
					if(schoolCode == '23'){
					$("#litabattend").after('<li class="li-tabs"><a href="#healthstatus" class="a-mypage-tab6">接種記録</a></li>');
					$('.a-mypage-tab6').off('click');
					$('.a-mypage-tab6').on('click', function(e) {
						e.preventDefault();
						var hash = $(this).attr('href').replace('#', '');
						location.hash = hash;
						$('.li-tabs').removeClass('active');
						$(this).closest('li').addClass('active');
						loadExtendPage('healthStatus');
					});
					}

					//「私のポートフォリオ」タブを追加
if($(".user-icon").text().substr(0,11) == '20201300001'){
					$(".nav-tabs .li-tabs:eq(5)").remove();
					$(".nav-tabs .li-tabs:eq(5)").after('<li class="li-tabs"><a href="#myportfolio" class="a-mypage-tab4">私のポートフォリオ</a></li>');
					$('.a-mypage-tab4').off('click');
					$('.a-mypage-tab4').on('click', function(e) {
						e.preventDefault();
						var hash = $(this).attr('href').replace('#', '');
						location.hash = hash;
						$('.li-tabs').removeClass('active');
						$(this).closest('li').addClass('active');
						loadExtendPage('portfolio/myPortfolio');
					});
}

					//卒業生向け「氏名等確認」タブを追加
					if(schoolCode != '11'){
						$.get("/portal/api/portalApi.php?type=getgradeandgradgrade", function(res){
							if(res && res.grade && res.grade == res.gradgrade && (res.domain != "FCOL") && res.enroll == 1){
								$(".nav-tabs .li-tabs:eq(2)").after('<li class="li-tabs"><a href="#checkname" class="a-mypage-tab5">氏名等確認</a></li>');
								$('.a-mypage-tab5').off('click');
								$('.a-mypage-tab5').on('click', function(e) {
									e.preventDefault();
									var hash = $(this).attr('href').replace('#', '');
									location.hash = hash;
									$('.li-tabs').removeClass('active');
									$(this).closest('li').addClass('active');
									loadExtendPage('checkname/checknamebirthday');
								});
							}
						});
					} else { // FCOL special
						$(".nav-tabs .li-tabs:eq(2)").after('<li class="li-tabs"><a href="#checkname" class="a-mypage-tab5">氏名等確認</a></li>');
						$('.a-mypage-tab5').off('click');
						$('.a-mypage-tab5').on('click', function(e) {
							e.preventDefault();
							var hash = $(this).attr('href').replace('#', '');
							location.hash = hash;
							$('.li-tabs').removeClass('active');
							$(this).closest('li').addClass('active');
							loadExtendPage('checkname/checknamebirthday');
						});
					}

					//fカレBS科,MD科のみ
					//「補講実施情報」タブを追加
					$.get("/portal/api/portalApi.php?type=myclassandnumber", function(res){
						//クラスを取得
						const sclass = res.class;
						if(/^(BS|MD)/.test(sclass)){
							$(".nav-tabs .li-tabs:eq(2)").after('<li class="li-tabs"><a href="#supplementclasses" class="a-mypage-tab-bsmd">補講実施情報</a></li>');
							$('.a-mypage-tab-bsmd').off('click');
							$('.a-mypage-tab-bsmd').on('click', function(e) {
								e.preventDefault();
								var hash = $(this).attr('href').replace('#', '');
								location.hash = hash;
								$('.li-tabs').removeClass('active');
								$(this).closest('li').addClass('active');
								loadExtendPage('mySupplementClasses');
							});
						}
					});

					//デフォルトで「履修状況」を表示
					if(document.location.href.endsWith("/mypage/") || document.location.href.endsWith("sMyPage.php") || document.location.href.endsWith("#status")){
						$('.li-tabs').removeClass('active');
						$('.a-mypage-tab1').closest('li').addClass('active');
						loadExtendPage('mySubjectStatus');
					}

					//最初から「課題提出状況」が選択されている場合の処理
					if(document.location.href.indexOf("#report") > 0){
						$('.li-tabs').removeClass('active');
						$('.a-mypage-tab2').closest('li').addClass('active');
						loadExtendPage('myReportStatus');
					}

					//最初から「出欠状況」が選択されている場合の処理
					if(document.location.href.indexOf("#myportfolio") > 0){
						$('.li-tabs').removeClass('active');
						$('.a-mypage-tab4').closest('li').addClass('active');
						loadExtendPage('portfolio/myPortfolio');
					}

					//最初から「私のポートフォリオ」が選択されている場合の処理
					if(document.location.href.indexOf("#attend") > 0){
						$('.li-tabs').removeClass('active');
						$('.a-mypage-tab3').closest('li').addClass('active');
						loadExtendPage('myAttendStatus');
					}

					//最初から「氏名等確認」が選択されている場合の処理
					if(document.location.href.indexOf("#checkname") > 0){
						$('.li-tabs').removeClass('active');
						$('.a-mypage-tab5').closest('li').addClass('active');
						loadExtendPage('checkname/checknamebirthday');
					}

					clearInterval(timer52);
				}
			}
			,200
		);
	}

	// スケジュール編集
	if(document.location.href.indexOf("/schedule/form/") > 0){
		// 選択削除
		$("#schedule_id").next("table").find("tr").each(function(){
			if($(this).children("th").text() == "公開範囲"){
				$(this).hide();
			}
		});
	}

	// 月表示
    let vcuryear = "";
    let vcurmon = "";
	if(document.location.href.indexOf("/schedule/list/") > 0){
		if(schoolCode == '23'){
		var timer88 = setInterval(
			function(){
				if($("#select-month").length && (vcuryear != $('#select-year').val() || vcurmon != $('#select-month').val())){
					$.get("/portal/lmsinc/makettpdf.php?count=1&year=" + $('#select-year').val() + "&month=" + $('#select-month').val(), function(res){
						$("#linkmtt").remove();
						if(Number(res) > 2){
							const pdflink = '<span id="linkmtt" style="margin-left: 5px"><a style="cursor: pointer;" onclick="linktoTimetable()">時間割</a></span>';
							$(".margin-bottom").append(pdflink);
						}
					});
    				vcuryear = $('#select-year').val();
				    vcurmon = $('#select-month').val();
				}
			}
		,250);
		}
	}

	//設定ページ
	if(document.location.href.indexOf("/lms/profile/") > 0){
		let timer97 = setInterval(
			function(){
				clearInterval(timer97);
			}
		,170);
		if($("#mail").length > 0){
			$("#mail").css('display', 'none');
			$("#mail").prev('p').css("display", "none");
		}
	}

	//メールページの場合
	var mailOvFlag = false;
	if(document.location.href.indexOf("/lms/mails") > 0){
		var timer6 = setInterval(
			function(){
				if(typeof searchMailMembers !== 'undefined' && !mailOvFlag){
					searchMailMembers=
					function(){
						if ($('input[name=member_q]').val().length) {
							params = {
								q: $('input[name=member_q]').val()
							};
							glexa.ajax({
								action: 'glexa_modal_mail_ajax_member_list',
								params: params,
								element: '#div-mail-members',
								onSuccess: function() {
									$('#div-mail-members').slideDown('fast');
									$('input[name=member_q]').val('');
								}
							});
						} else {
							$('#div-mail-members').slideUp('fast');
						}
					};
					mailOvFlag = true;
				}
				if($("#div-common-remote-modal").css("display") == "none"){
					searchMailMembers = undefined;
					mailOvFlag = false;
				}
			}
		,100);
	}

	// フォーラムページ
	if(document.location.href.indexOf("/lms/plugin/forum/topic/") > 0){
		var timer98 = setInterval(function(){
			if($("a.a-like-topic[show-icon!='marked'], a.a-unlike-topic[show-icon!='marked']").length > 0){
				$("a.a-like-topic[show-icon!='marked'], a.a-unlike-topic[show-icon!='marked']").each(function(idx, elm){
					const lkcnt = parseInt($(elm).find(".badge:first").text());
					if(!isNaN(lkcnt) && lkcnt > 0){
						// add person icon
						$(elm).find(".badge:first").after('<img src="/lms/common/images/icons/members.png" alt="" class="icon" onclick="event.stopPropagation(); event.preventDefault(); showLikePerson(this);">');
						$(elm).attr("show-icon", "marked");
					} else {
						$(elm).find("img").remove();
						$(elm).attr("show-icon", "");
					}
				});
			}
		} ,250);
	}

	//「先生にメールを送る」の無効化(YDAのみ)
/*
	if(schoolCode == '21'){
		var timer99 = setInterval(
			function(){
				if($(".a-modal-teacher-mail-form").length > 0){
					$(".a-modal-teacher-mail-form").remove();
					clearInterval(timer99);
				}
			}
			,200
		);
	}

	//「メール」機能の無効化(YDAのみ)
	if(schoolCode == '21'){
		$("a[href='/lms/mails/']").parent().remove();
	}
*/

	//受講クラス登録完了ページの処理
	var panalHeaderText = $("div.panel-heading:first").text();
	if(panalHeaderText && panalHeaderText.includes('受講クラス登録完了')){
		$.get("/portal/lmsinc/getGlexaDBUtil_.php?type=updatepublicclassteam", function(res){console.log(res);});
	}

	var timer98 = setInterval(
		function(){
			if( $(".class-menu li").length > 3 ){
				clearInterval(timer98);
				$(".class-menu li:lt("+($(".class-menu li").length-2)+")").hide();
			}
		}
	,250);

	//学生Quizで解答完了後に表示される結果画面
	if(/content\/[0-9]+\/quiz/.test(document.location.href)){
		searchQuizResultTable();
	}

	// 学生Quiz結果
	if(document.location.href.indexOf("/quiz/result/") > 0){
		searchQuizResultTable();

		/*if(schoolCode == 11){
			// MutationObserverを使用して、DOMの変化を監視
			var observer = new MutationObserver(function(mutationsList){
				for(var mutation of mutationsList) {
					if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {

						mutation.addedNodes.forEach(function(node){
							//tableが追加されたら、各要素にclassを付与
							if(node.firstElementChild && node.firstElementChild.tagName.toLowerCase() === 'table'){

								// thは一括で消しておきたいが、一応tdと対応するようにはしよう
								// 最初の行だけquiz_page,後は「quizResult_数字」とする
								$('table th').each(function() {
									const index = $(this).index();
									if(index == 0){
										$(this).addClass("quiz_page");
									}else{
										$(this).addClass("quizResult_" + (index - 1));
									}
									$(this).addClass("quizResult_th");
									//$('td:nth-child(' + (index + 1) + ')').addClass($(this).attr('class'));
								});

								//tdは3つのクラスを設定
								//書いてる情報:ページ番号→quiz_page,その他→「quizResult_数字」
								//ページ数:quizPage_数字
								//行番号:quizRow_数字
								let parent_tr_page = null;
								let rowIndex = 0;
								let colIndex = 0;
								let rowspan = 0;
								let pageNum = 0;

								$('table td').each(function(){
									const td = $(this);

									td.addClass("quizResult_td");

									const tr = td.closest('tr');

									if(tr.is(parent_tr_page)){
										//同じ行
										td.addClass("quizResult_" + colIndex);
										colIndex++;
										td.addClass("quizRow_" + rowIndex);
									}else{
										parent_tr_page = tr;

										//違う行
										rowspan--;
										colIndex = 0;
										rowIndex++;
										if(rowspan < 1){
											//新しいページ
											rowspan = td.attr('rowspan') || 1;
											td.addClass("quiz_page");
											pageNum++;
										}else{
											td.addClass("quizResult_" + colIndex);
											colIndex++;
											td.addClass("quizRow_" + rowIndex);
										}
									}
									td.addClass("quizPage_" + pageNum);

									td.css("white-space", "normal");
								})

								observer.disconnect();
							}
						})
					}
				}
			});

			// 監視を開始
			observer.observe(document.body, { subtree: true, childList: true });

			const quizResultStyle = '<link rel="stylesheet" href="/portal/lmsinc/quizResult.css">';
			$('head link:last').after(quizResultStyle);
		}*/

	}

	//クイズ結果発表を表示するtableの検索
	function searchQuizResultTable(){
		$.get("/portal/lmsinc/portalDBUtil.php?type=getLoginUserInfo", function(res){
			if(res.result == 'error'){
				console.log('ログイン情報なし');
			}else{
				const sId = res.rows.login;
				if(schoolCode == 11 || sId == 1300001){
					//スマートフォン用レイアウトのcss追加
					const quizResultStyle = '<link rel="stylesheet" href="/portal/lmsinc/quizResult.css">';
					$('head link:last').after(quizResultStyle);

					//前回取得したtableの親要素
					let pre_div;

					//一定時間ごとにテーブルの更新を確認する
					const interval = setInterval(() => {
						//クイズ関連のページから抜けた際に停止
						if(document.location.href.indexOf("/quiz/result/") <= 0　
						&& !/content\/[0-9]+\/quiz/.test(document.location.href)){
							clearInterval(interval);
							return;
						}
						//目当てのtableの親要素を取得
						const div = $('div.table-responsive');
						//問題（qtype）の場合は除外
						const div_notquiz = div.filter(function() {
							const classNames = $(this).attr('class').split(' ');

							for(let i = 0;i < classNames.length;i++){
								const pattern = /qtype-[0-9]+/;
								if(pattern.test(classNames[i])){
									return false;
								}
							}
							return true;
						})
						//console.log(div_notquiz);
						//何も取得できていない=存在しない場合は飛ばす
						if(div_notquiz.length > 0){
							//前回何も取得できていなければ取得処理
							if(!pre_div){
								overwritingQuizResultTable(div.children('table').first());
							}else{
								//前回と完全に一致する場合は飛ばす
								if(pre_div.html() === div.html()){
									//console.log('equal');
								}else{
									overwritingQuizResultTable(div.children('table').first());
								}
							}
						}

						pre_div = div;
					}, 1000);
				}
			}
		})
	}
	//クイズ結果発表を表示するtableの書き換え
	function overwritingQuizResultTable(table){
		//console.log(table);
		if(table.length <= 0) return;

		// thは一括で消しておきたいが、一応tdと対応するようにはしよう
		// 最初の行だけquiz_page,後は「quizResult_数字」とする
		table.find('th').each(function() {
			const index = $(this).index();
			if(index == 0){
				$(this).addClass("quiz_page");
			}else{
				$(this).addClass("quizResult_" + (index - 1));
			}
			$(this).addClass("quizResult_th");
			//$('td:nth-child(' + (index + 1) + ')').addClass($(this).attr('class'));
		});

		//tdは3つのクラスを設定
		//書いてる情報:ページ番号→quiz_page,その他→「quizResult_数字」
		//ページ数:quizPage_数字
		//行番号:quizRow_数字
		let parent_tr_page = null;
		let rowIndex = 0;
		let colIndex = 0;
		let rowspan = 0;
		let pageNum = 0;

		table.find('td').each(function(){
			const td = $(this);

			td.addClass("quizResult_td");

			const tr = td.closest('tr');

			if(tr.is(parent_tr_page)){
				//同じ行
				td.addClass("quizResult_" + colIndex);
				colIndex++;
				td.addClass("quizRow_" + rowIndex);
			}else{
				parent_tr_page = tr;

				//違う行
				rowspan--;
				colIndex = 0;
				rowIndex++;
				if(rowspan < 1){
					//新しいページ
					rowspan = td.attr('rowspan') || 1;
					td.addClass("quiz_page");
					pageNum++;
				}else{
					td.addClass("quizResult_" + colIndex);
					colIndex++;
					td.addClass("quizRow_" + rowIndex);
				}
			}
			td.addClass("quizPage_" + pageNum);

			td.css("white-space", "normal");
		})
	}


	//TODO:とりあえずiLiS利用者のみiLiSボタン表示
//	$.get("/portal/lmsinc/iLiSApi.php?type=isilisuser", function(res){
	if(schoolCode == '12' || schoolCode == '19'){
//		if(res.iLiSUser){
			let html = '<div style="display:inline-block; padding-top:0.3em" id="iLiSLogoArea" waitKey=""><a href="" onclick="openILiS(); return false;"><img src="/portal/img/iLiS/iLiS.png" height="38" /></a></div>';
			html	+= '<div style="display:none; padding-top:0.3em; margin-left:0.3em;" id="iLiSSharedScreenThumbArea"><a href="" onclick="openILiSSharedScreen(); return false;"><img style="height:3em" /></a><small style="vertical-align:middle">&nbsp;画面共有中</small></div>';
			$(".navbar-header").append(html);
//		}
	}
//	});

	//iポータルへのリンク(スマホ用)
	//$(".navbar-header").append('<a href="/portal/" id="jumpToiPortalLink">&nbsp;＞iポータル</a>');

	$(document).on('click', '.plfmfsend', function(e) {
		e.preventDefault();
		plfmSendMail();
	});

	$(document).on('click', '.himmfsend', function(e) {
		e.preventDefault();
		himrecordhealthstatus();
	});
	
	let today = new Date();
	
	if(today < new Date("2025/10/26 17:00:00")){
		const $deco_url = "/portal/lmsinc/eventdeco/iwafes_deco_2025.js";
		const script = document.createElement('script');
		script.src = $deco_url;
		script.type = "module";
		document.head.appendChild(script);
	}

	//ハロウィン2025追加
	if(today >= new Date("2025/10/27 08:00:00") && today < new Date("2025/11/01 00:00:00")){
		const $deco_url = "/portal/lmsinc/eventdeco/halloween_deco_2025.js";
		const script = document.createElement('script');
		script.src = $deco_url;
		script.type = "module";
		document.head.appendChild(script);
	}
	
});

function applyIwafesBackground(){
	return;
	const targetDates = [
	        { date: "10/99（土）", type: "before", image: "/portal/img/iwafes2025.png" },
	        { date: "10/99（日）", type: "after", image: "/portal/img/iwafes2025.png" },
	        { date: "10/31（金）", type: "base", image: "/portal/img/halloween2025.png" }
	];
	const headerTable = document.querySelector("table.top-timetable-table");
	const cells = document.querySelectorAll("table.top-timetable-table td");
	const bgTable = document.querySelector("table.table-bordered.margin-bottom-none.top-timetable-table");
	if(bgTable == null) return;
	const bgtbody = bgTable.querySelector("tbody");
	const tableDiv = document.querySelector("#div-top-timetable2");
	bgtbody.style.backgroundImage = '';
	bgTable.style.backgroundImage = '';
	tableDiv.style.backgroundImage = '';
	bgtbody.style.backgroundColor = "rgba(255,255,255,0.85)";
	bgtbody.style.backgroundBlendMode = "lighten";

	targetDates.forEach(item => {
		cells.forEach(td => {
			if (td.textContent.includes(item.date)) {
				// to get cells' position
				const headerRect = headerTable.getBoundingClientRect();
				const rect = td.getBoundingClientRect();

				const bgWidth  = rect.width - 20;
				const bgHeight = (bgWidth * 18) / 7;
				const bgLeft   = rect.left - headerRect.left + 20;

				if (item.type === "base") {
					bgtbody.style.backgroundImage = `url('${item.image}')`;
					bgtbody.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
					bgtbody.style.backgroundRepeat = "no-repeat";
					bgtbody.style.backgroundPositionX = `${bgLeft}px`;
				} else if (item.type === "after") {
					if(bgTable.style.width > tableDiv.style.width){
						tableDiv.style.width = bgTable.style.width;
					}
					tableDiv.style.backgroundImage = `url('${item.image}')`;
					tableDiv.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
					tableDiv.style.backgroundRepeat = "no-repeat";
					tableDiv.style.backgroundPositionX = `${bgLeft}px`;
				} else if (item.type === "before") {
					bgTable.style.backgroundImage = `url('${item.image}')`;
					bgTable.style.backgroundSize = `${bgWidth}px ${bgHeight}px`;
					bgTable.style.backgroundRepeat = "no-repeat";
					bgTable.style.backgroundPositionX = `${bgLeft}px`;
				}
			}
		});
	});
}

window.addEventListener("resize", applyIwafesBackground);

//ランダム文字列生成
function randomStr(len){
	let chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let rand_str = '';
	for ( var i = 0; i < len; i++ ) {
		rand_str += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return rand_str;
}

function escapeStr(str) {
  if(str == null) str = '';
  str = str.replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  return str;
}

function escapeStrB(str) {
  if(str == null) str = '';
  str = str.replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return str;
}

function openLinkRecord(classId, directoryId, url){
//	console.log(url);

	//まずは resouce_id と content_id を検索
	$.post("/portal/lmsinc/getGlexaDBUtil.php?type=findresourceid", {classId:classId, directoryId:directoryId, url:url},
		function(res){
//			console.log(JSON.stringify(res));
			if(res.rows.length == 0) return;

			var req = {
				classId: classId,
				directoryId: directoryId,
				resourceId: res.rows[0].resource_id,
				contentId: res.rows[0].content_id
			};

			//履歴レコードを追加
			$.post("/portal/api/portalApi.php?type=insertopenlinklog",
				JSON.stringify(req),
				function(res){
//					console.log(JSON.stringify(res));
				}
			);
		}
	);
}

function openLinkRecordById(classId, directoryId, resourceId, contentId){
	var req = {
		classId: classId,
		directoryId: directoryId,
		resourceId: resourceId,
		contentId: contentId
	};

	//履歴レコードを追加
	$.post("/portal/api/portalApi.php?type=insertopenlinklog",
		JSON.stringify(req),
		function(res){

		}
	);
}

function checkAttendEntry(classId){
	if($("#div-common-remote-modal").length == 0 || $("#div-common-remote-modal").css("display") == 'none'){
		isClassEntryOpened = false;
		if (!isClassEntryOpened) {
			glexa.ajax({
				action: 'glexa_modal_entry_form',
				params: {
					class_id: classId,
					is_ajax: 1
				},
				withoutLoading: true,
				onSuccess: function(result) {
					if (result.data.is_accepted != '1') {
						glexa.openRemoteModal({
							action: 'glexa_modal_entry_form',
							params: {
								class_id: classId
							}
						});
						isClassEntryOpened = true;
					}
					else{
						glexa.openCommonAlertModal({title:"情報", body:"現在、新たな出席確認は行われていません", onOk:function(){ glexa.closeCommonAlertModal(); }} );
					}
				}
			})
		}
	}
}

let LateFormModal = false;
let lrfClassInfo = [];
let lrfRcptTo = [];
function postLateFormEntry(classId){
	if(!LateFormModal){
		const plfstyle = document.createElement("style");
		document.head.appendChild(plfstyle);
		plfstyle.sheet.insertRule(".postlateformmodal .tingle-modal-box{width: 720px; border-radius: 6px; border: 1px solid transparent;}", 0);
		plfstyle.sheet.insertRule(".postlateformmodal .tingle-modal-box .tingle-modal-box__content{padding: 0px;}", 0);
		plfstyle.sheet.insertRule(".plfmtable{font-size: 14px; text-align: left; padding: 3px; border: 0px;}", 0);
		plfstyle.sheet.insertRule(".plfmcolz{width: 100px; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcol0{width: 100px; padding: 7px 3px; color: #336600; font-weight: bold;}", 0);
		plfstyle.sheet.insertRule(".plfmcol1{width: 220px; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcol2{width:  72; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcol3{width: 120px; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcol4{width:  46; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcol5{width: 120px; padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcolm{padding: 7px 3px;}", 0);
		plfstyle.sheet.insertRule(".plfmcolw{padding: 7px 3px; font-weight: bold;}", 0);
		plfstyle.sheet.insertRule("#plfmilatet{display: inline; width: 80px; margin-right: 5px;}", 0);
		plfstyle.sheet.insertRule("#plfmilatem{display: inline; width: 80px; margin-left: 10px;}", 0);
		plfstyle.sheet.insertRule("#plfmitrline{width: 300px;}", 0);
		plfstyle.sheet.insertRule("#plfmidate{display: inline;}", 0);

		let html = '';
		html += '<div style="font-color: black; background-color: #f5f5f5; padding: 9px; font-size: 14px; border-radius: 6px 6px 0px 0px; text-align: left;">';
		html += '  遅延証明';
		html += '</div>';
		html += '<div style="padding: 4px 8px;">';
		html += '  <table class="plfmtable">';
		html += '    <tr><td class="plfmcolz">対象科目:</td><td class="plfmcol1" id="plfmclass"></td><td class="plfmcol2">担当教員:</td><td class="plfmcol3" id="plfmcharger"></td><td class="plfmcol4">担任:</td><td class="plfmcol5" id="plfmhrteacher"></td></tr>';
		html += '    <tr><td class="plfmcol0">授業日:</td><td class="plfmcolm" colspan="5"><select class="form-control" id="plfmidate" onchange="lrfCinfoChange();">';
		let prevtdate = '';
		let recenttd = lrfClassInfo.reduce((x,y) => x.date > y.date ? x : y);
		lrfClassInfo.forEach(elrfc => {
			if(prevtdate != elrfc.date){
				const pdstring = Number(elrfc.date.substr(4, 2)) + '月' + Number(elrfc.date.substr(6, 2)) + '日';
				html += '    <option value="' + elrfc.date + '" ' + (recenttd.date == elrfc.date ? "selected" : "" ) +' >' + pdstring +'</option>';
				prevtdate = elrfc.date;
			}
		});
		html += '    </select></td></tr>';
		html += '    <tr><td class="plfmcol0">授業時間:</td><td class="plfmcolm" colspan="5" id="plfmictime"><input type="hidden" id="plfmcstart" value="2"><input type="hidden" id="plfmcend" value="2"><span id="plfmcomma">2限</span></td></tr>';
		html += '    <tr><td class="plfmcol0">到着時刻:</td><td class="plfmcolm" colspan="5"><input type="number" min="8" max="16" class="form-control" id="plfmilatet" list="lateTimeList">時<input type="number" min="0" max="59" class="form-control" id="plfmilatem" list="lateMinList">分</td></tr>';
		html += '    <tr><td class="plfmcol0">遅延路線名:</td><td class="plfmcolm" colspan="5"><input type="text" class="form-control" id="plfmitrline" list="trLineList"></td></tr>';
		html += '    <tr><td class="plfmcol0">遅延証明書:</td><td class="plfmcolm" colspan="5"></td></tr>';
		html += '    <tr><td class="plfmcolw" colspan="6">※紙の証明書の場合は、スマートフォンで日付・時間がわかるように撮影してください</td></tr>';
		html += '    <tr><td class="plfmcolw" colspan="6">　もしくは各鉄道会社の Web サイトにて遅延証明書をダウンロードしてください</td></tr>';
		//html += '    <tr><td class="plfmcolm" colspan="6"><div id="plfm-uploader" class="dropzone dz-clickable"><div class="dz-default dz-message"><span>ファイルアップロード</span></div></div><div id="plfm-preview-uploads"></div><div id="div-files"></div></td></tr>';
		html += '    <tr><td class="plfmcolm" colspan="6">';
		html += '<form id="form-mail">';
		html += '<input type="hidden" name="action" value="glexa_modal_mail_form_accept">';
		html += '<input type="hidden" name="reply_mail_id" value="">';
		html += '<input type="hidden" name="signature" value="">';
		html += '<input type="hidden" name="atGrade" value="">';
		html += '<input type="hidden" name="csrf_token" id="plfmcsrf" value="">';
		//html += '<input type="hidden" id="member_id_5131" name="member_ids[5131]" value="5131">';
		html += '<input type="hidden" name="title" value="遅延証明書">';
		html += '<input type="hidden" name="body" id="plfmbody" value="">';
		//html += '<input type="hidden" name="file_session_key" value="">';
		html += '    <div id="plfm-uploader"><div class="dz-default dz-message"><span>ファイルアップロード</span></div></div><div id="plfm-preview-uploads"></div><div id="div-files"></div>';
		html += '    </td></tr>';
		html += '</form>';
		html += '  </table>';
		html += '</div>';
		html += '<datalist id="lateTimeList">';
		html += '  <option value="8">';
		html += '  <option value="9">';
		html += '  <option value="10">';
		html += '  <option value="11">';
		html += '  <option value="12">';
		html += '  <option value="13">';
		html += '  <option value="14">';
		html += '  <option value="15">';
		html += '</datalist>';
		html += '<datalist id="lateMinList">';
		html += '  <option value="0">';
		html += '  <option value="5">';
		html += '  <option value="10">';
		html += '  <option value="15">';
		html += '  <option value="20">';
		html += '  <option value="25">';
		html += '  <option value="30">';
		html += '  <option value="35">';
		html += '  <option value="40">';
		html += '  <option value="45">';
		html += '  <option value="50">';
		html += '  <option value="55">';
		html += '</datalist>';
		html += '<datalist id="trLineList">';
		html += '  <option value="東海道線">';
		html += '  <option value="横須賀線">';
		html += '  <option value="市営地下鉄">';
		html += '  <option value="横浜線">';
		html += '  <option value="東急東横線">';
		html += '  <option value="京浜東北線">';
		html += '  <option value="横浜線">';
		html += '  <option value="相鉄">';
		html += '  <option value="京急">';
		html += '  <option value="相模線">';
		html += '  <option value="金沢シーサイドライン">';
		html += '  <option value="湘南モノレール">';
		html += '  <option value="江ノ電">';
		html += '  <option value="ドリームランド線">';
		html += '</datalist>';
		html += '<div style="padding: 8px 8px; text-align: right;">';
		html += '  <button class="btn btn-primary size10 plfmfsend">送信</button>';
		html += '</div>';

		LateFormModal = new tingle.modal({
			cssClass: ['postlateformmodal'],
			closeMethods: ['overlay', 'button', 'escape'],
			closeLabel: "閉じる"
		});
		LateFormModal.setContent(html);
		//$("#plfm-uploader").dropzone({
		//	url: 'url/post'
		//});
		glexa.uploader({
			uploadElement: '#plfm-uploader',
			previewElement: '#plfm-preview-uploads',
			acceptedFiles: 'image/*,application/pdf',
			onUploadSuccess: function() {
				glexa.ajax({
					onSuccess: function() {
					}
				});
			}
		});
	}
	lrfCinfoChange();
	LateFormModal.open();
}

function lrfCinfoChange(){
	let lrfCmin = 9;
	let lrfCmax = 1;
	let lrfComma = "";
	let lrfClass = "";
	let lrfHRT = [];
	let lrfCLT = [];
	lrfRcptTo = [];
	lrfClassInfo.forEach(elrfc => {
		if(elrfc.date == $("#plfmidate").val()){
			lrfCmax = lrfCmax < elrfc.comma ? elrfc.comma : lrfCmax;
			lrfCmin = lrfCmin > elrfc.comma ? elrfc.comma : lrfCmin;
			lrfComma += elrfc.comma + "限 ";
			lrfClass = elrfc.displayName;
			if(lrfHRT.find(et => et == elrfc.hrtc) === undefined){
				lrfHRT.push(elrfc.hrtc);
			}
			if(lrfCLT.find(et => et == elrfc.stftc) === undefined){
				lrfCLT.push(elrfc.stftc);
			}
			// make rcpt to
			// homeroom teacher for all
			if(lrfRcptTo.find(et => et == elrfc.hrtid) === undefined){
				lrfRcptTo.push(elrfc.hrtid);
			}
			// class teacher for ISC, KANGO, HOIKU
			if(schoolCode == '12' || schoolCode == '23' || schoolCode == '34'){
				if(lrfRcptTo.find(et => et == elrfc.stfid) === undefined){
					lrfRcptTo.push(elrfc.stfid);
				}
			}
			// office staff for REHA
			if(schoolCode == '33'){
				if(lrfRcptTo.find(et => et == elrfc.ofcid) === undefined){
					lrfRcptTo.push(elrfc.ofcid);
				}
			}
		}
	});
	$("#plfmcstart").val(lrfCmin);
	$("#plfmcend").val(lrfCmax);
	$("#plfmcomma").text(lrfComma);
	$("#plfmclass").text(lrfClass);
	$("#plfmcharger").text(lrfCLT.join(' '));
	$("#plfmhrteacher").text(lrfHRT.join(' '));

	// delete old rcpt to
	$('#form-mail').find('input:hidden').each((idx, elm) => {
		if($(elm).attr("name").startsWith("member_ids")){
			$(elm).remove();
		}
	});
	// and add rcpt to
	lrfRcptTo.forEach(etid => {
		$("<input>").attr("type", "hidden").addClass("lrfrcptto").attr("id", "member_id_" + etid).attr("name", "member_ids[" + etid + "]").val(etid).appendTo("#form-mail");
	});
}

function plfmSendMail(){
	// check value
	let plfmmes = "";

	if($("#plfmilatet").val() == "" || $("#plfmilatem").val() == "")
		plfmmes += "到着時刻";
	if($("#plfmitrline").val() == "")
		plfmmes += (plfmmes == "" ? "": "と") + "路線名";
	if($("#plfm-preview-uploads").find('div').length == 0)
		plfmmes += (plfmmes == "" ? "": "と") + "遅延証明書";

	if(plfmmes != ""){
		glexa.alert(plfmmes + "を入れて下さい。");
		return;
	}

	// make mail body
	const plfmwhoami = $(".user-icon").text().split("\u00A0");
	if(plfmwhoami.length < 2){
		return;
	}
	const plfmdate = $("#plfmidate").val();
	if(plfmdate.length != 8){
		glexa.alert("授業日が不正です。");
		return;
	}


	//let plfmclassname = document.title.split(' | ')[0];
	let plfmclassname = $("#plfmclass").text();

	// get class and number
	$.get("/portal/api/portalApi.php?type=myclassandnumber", function(res){
		if(res.class != null && res.number != null && res.ftn != null){
			$("#plfmcsrf").val(res.ftn);
			const plfmbody = res.class + "(" + res.number + ") " + plfmwhoami[1] + " です。\r\n" + Number(plfmdate.substr(4, 2)) + "月" + Number(plfmdate.substr(6, 2)) + "日の授業「" + plfmclassname + "」にて電車遅延により遅刻いたしました。\r\n大変申し訳ございませんでした。\r\nなお、教室には" + $("#plfmilatet").val() + "時" + $("#plfmilatem").val() + "分に入室いたしました。\r\n遅延証明書をお送りしますので、確認のほどよろしくお願いいたします。";
			$("#plfmbody").val(plfmbody);

			glexa.ajax({
				action: 'glexa_modal_mail_form_accept',
				params: $('#form-mail').serializeArray(),
				onSuccess: function() {
					glexa.localStorage.removeItem('mail-tmp-title');
					glexa.localStorage.removeItem('mail-tmp-body');
					glexa.alert('遅延証明書を送信しました');
					if (LateFormModal) {
						LateFormModal.close(true);
					}
				}
			});
		}
	});
}

let healthInputModal = false;
function healthInputForm(){
	if(!healthInputModal){
		const himstyle = document.createElement("style");
		document.head.appendChild(himstyle);
		himstyle.sheet.insertRule(".healthinputformmodal .tingle-modal-box{width: 380px; border-radius: 6px; border: 1px solid transparent;}", 0);
		himstyle.sheet.insertRule(".healthinputformmodal .tingle-modal-box .tingle-modal-box__content{padding: 0px;}", 0);
		himstyle.sheet.insertRule(".himmtable{font-size: 14px; text-align: left; padding: 3px; border: 0px;}", 0);
		himstyle.sheet.insertRule(".himmcol0{width:  80px; padding: 7px 3px; color: #336600; font-weight: bold;}", 0);
		himstyle.sheet.insertRule(".himmcol1{width: 280px; padding: 7px 3px;}", 0);
		himstyle.sheet.insertRule(".himmcolm{padding: 7px 3px;}", 0);
		himstyle.sheet.insertRule("#himmitempe{display: inline; width: 80px; margin-right: 5px;}", 0);
		himstyle.sheet.insertRule("#himmilatem{display: inline; width: 80px; margin-left: 10px;}", 0);
		himstyle.sheet.insertRule("#himmitrline{width: 270px;}", 0);

		const html = `
		<div style="font-color: black; background-color: #f5f5f5; padding: 9px; font-size: 14px; border-radius: 6px 6px 0px 0px; text-align: left;">
		  健康状態入力
		</div>
		<div style="padding: 4px 8px;">
		  <table class="himmtable">
		    <tr><td class="himmcol0">体温:</td><td class="himmcolm"><span id="himmodetempe"><input type="number" min="33" max="43" step="0.1" class="form-control" id="himmitempe">度</span><span id="himmodefeel" style="display: none;"><select id="himmifeel"><option value="0">寒気がする</option><option value="1">少し寒気がする</option><option value="2" selected>普段通り</option><option value="3">少し熱っぽい</option><option value="4">熱っぽい</option></select></span><span style="padding: 10px;"></span><input type="checkbox" id="himmcnothermo" onchange="himthermomodechange();"><label for="himmcnothermo">体温計がない</label></td></tr>
		    <tr><td class="himmcol0">症状:</td><td class="himmcolm" id="himmictime"><input type="checkbox" id="himmccough"><label for="himmccough">咳がある</label><br><input type="checkbox" id="himmheadache"><label for="himmheadache">頭痛がする</label><br><input type="checkbox" id="himmcfatigue"><label for="himmcfatigue">倦怠感がある</label><br><input type="checkbox" id="himmcstuffiness"><label for="himmcstuffiness">息苦しい</label><br><input type="checkbox" id="himmcnausea"><label for="himmcnausea">吐き気がある</label></td></tr>
		    <tr><td class="himmcol0">その他:</td><td class="himmcolm"><input type="text" class="form-control" id="himmitrline"></td></tr>
		  </table>
		</div>
		<div style="padding: 8px 8px; text-align: right;">
		  <button class="btn btn-primary size10 himmfsend">記録</button>
		</div>
		`;

		healthInputModal = new tingle.modal({
			cssClass: ['healthinputformmodal'],
			closeMethods: ['overlay', 'button', 'escape'],
			closeLabel: "閉じる"
		});
		healthInputModal.setContent(html);
	}
	lrfCinfoChange();
	healthInputModal.open();
}

// 体温入力←→体温感覚入力、切り替え
function himthermomodechange(){
	// to get check box status
	const hinothermo = $("#himmcnothermo").prop("checked");

	// to control hide-show elements
	if(hinothermo){
		$("#himmodetempe").hide();
		$("#himmodefeel").show();
	} else {
		$("#himmodefeel").hide();
		$("#himmodetempe").show();
	}
}

// 記録ボタン動作 - 入力のチェックをしたあとに健康状態保存
function himrecordhealthstatus(){
	// to get check box status
	const hinothermo = $("#himmcnothermo").prop("checked");
	let himbodyTemperature = '';
	let himfeelTemperature = '';

	// to check required value
	if(hinothermo){
		himfeelTemperature = $("#himmifeel").val();
		if (himfeelTemperature < 0 || himfeelTemperature > 4) {
			alert("体温感覚の選択がおかしいです");
			return;
		}
	} else {
		himbodyTemperature = parseFloat($("#himmitempe").val());
		if (isNaN(himbodyTemperature) || himbodyTemperature < 34 || himbodyTemperature > 43) {
			alert("体温がおかしいです(爬虫類？)");
			return;
		}
	}

	// date and time handling
	const himnow = new Date();
	const himhhmm = String(himnow.getHours()).padStart(2, '0') + String(himnow.getMinutes()).padStart(2, '0');
	const himymd = `${himnow.getFullYear()}-${String(himnow.getMonth() + 1).padStart(2, '0')}-${String(himnow.getDate()).padStart(2, '0')}`;

	// to post for save
	var postparam = {
		date: himymd,
		time: himhhmm,
		bodyTemperature: himbodyTemperature,
		feelTemperature: himfeelTemperature,
		cough: ($("#himmccough").prop("checked") ? "1" : "0"),
		headache: ($("#himmheadache").prop("checked") ? "1" : "0"),
		fatigue: ($("#himmcfatigue").prop("checked") ? "1" : "0"),
		stuffiness: ($("#himmcstuffiness").prop("checked") ? "1" : "0"),
		nausea: ($("#himmcnausea").prop("checked") ? "1" : "0"),
		remarks: $("#himmitrline").val()
	};

	$.post("/portal/api/healthApi.php?type=recordtemperaturepost&sid=", JSON.stringify(postparam), function(resjson){
		if(resjson && resjson != ""){
			res = JSON.parse(resjson);
			if(res && res.success){
				// to show message and close
				if(hinothermo){
					const hitfeelsel = $("#himmifeel").val();
					alert("体温感覚を記録しました");
				} else {
					const hitempeval = parseFloat($("#himmitempe").val());
					alert("体温 " + hitempeval.toFixed(1) + " 度を記録しました");
				}
				// remove button
				$("#liinputbodytempe").remove();
				healthInputModal.close();
			} else {
				alert("健康状態の記録に失敗しました");
			}
		} else {
			alert("健康状態の記録に失敗しました");
		}
	});

}

// 時間割始まり曜日情報保存
function ttshowset(caller, modesw){
	if(modesw == "off"){
		$.get("/portal/api/portalApi.php?type=removetimetablesetting&nid="+$(".user-icon").text().substr(0,11), function(res){
			$(".before-one-day-btn").css("display", "inline-block");
			$(".after-one-day-btn").css("display", "inline-block");
			$(caller).css("opacity", "0.3");
			const ptitle = $(caller).parent().attr("title").replace('時間割の', '時間割を').replace('始まりを解除する', '始まりで固定する');
			$(caller).parent().attr("title", ptitle);
			// refresh
			//location.reload();
		});
	} else {
		$.get("/portal/api/portalApi.php?type=settimetablesetting&startd=" + modesw + "&nid="+$(".user-icon").text().substr(0,11), function(res){
			// never mind, will be reload
			//$(".before-one-day-btn").css("display", "none");
			//$(".after-one-day-btn").css("display", "none");
			//$(".ttmodeanchor").css("opacity", "0.3");
			//$(caller).css("opacity", "1.0");
			//const ptitle = $(caller).parent().attr("title").replace('時間割を', '時間割の').replace('始まりで固定する', '始まりを解除する');
			//$(caller).parent().attr("title", ptitle);
			// refresh
			location.reload();
		});
	}
	return;
}

function linktoTimetable(){
		window.open('/portal/lmsinc/makettpdf.php?year=' + $('#select-year').val() + '&month=' + $('#select-month').val());
}

// いいねの人を確認
function showLikePerson(caller){
	//alert($(caller).parent().attr("topic_id"));
	$.get("/portal/lmsinc/getGlexaDBUtil.php?type=getlikeperson&topicid=" + $(caller).parent().attr("topic_id"), function(res){
		if(res.error != ''){
			// nop, silent now
		}
		else{
			// on pure javascript
			// background screen for close as click
			const boundrect = caller.getBoundingClientRect();
			const bgscreen = document.createElement("div");
			bgscreen.id = "bgscreendiv";
			bgscreen.style.position = "absolute";
			bgscreen.style.top = "0px";
			bgscreen.style.left = "0px";
			bgscreen.style.height = document.body.scrollHeight + "px";
			bgscreen.style.width = document.body.scrollWidth + "px";
			bgscreen.onclick = function(){this.remove();};
			// main modal window
			const pupplist = document.createElement("div");
			pupplist.style.position = "absolute";
			pupplist.style.backgroundColor = "white";
			pupplist.style.top = (boundrect.y + (document.body.scrollTop || document.documentElement.scrollTop)  - document.documentElement.clientTop + caller.offsetHeight) + 'px';
			pupplist.style.left = (boundrect.x + (document.body.scrollLeft || document.documentElement.scrollLeft) - document.documentElement.clientLeft - 310) + 'px';
			pupplist.style.border = "solid 1px #8bc56b";
			pupplist.style.padding = "0px";
			pupplist.style.borderRadius = "5px";
			pupplist.style.boxShadow = "2px 2px 4px gray";
			bgscreen.appendChild(pupplist);
			// modal title
			const plisttbltitle = document.createElement("div");
			plisttbltitle.style.height = "25px";
			plisttbltitle.style.padding = "3px";
			plisttbltitle.style.backgroundColor = "#f5f5f5";
			plisttbltitle.innerHTML = "<i class='mark'></i>いいね！をした人";
			pupplist.appendChild(plisttbltitle);
			// div for scroll
			const plisttblscroll = document.createElement("div");
			plisttblscroll.style.height = "300px";
			plisttblscroll.style.paddingRight = "12px";
			plisttblscroll.style.overflowY = "auto";
			plisttblscroll.style.WebkitOverflowScrolling = "touch";
			// list table
			const plisttbl = document.createElement("table");
			plisttbl.style.width = "300px";
			plisttbl.style.tableLayout = "fixed";
			const plisttbody = document.createElement("tbody");
			plisttbl.appendChild(plisttbody);
			// each person
			for(i = 0; i < res.rows.length; i++){
				const plisttr = document.createElement("tr");
				plisttr.onmouseover = function(){this.style.backgroundColor = "lightyellow";};
				plisttr.onmouseout = function(){this.style.backgroundColor = "";};
				plisttbody.appendChild(plisttr);
				const plisttd0 = document.createElement("td");
				plisttd0.style.padding = "3px";
				plisttd0.style.width = "160px";
				plisttd0.style.overflow = "hidden";
				plisttd0.style.textOverflow = "ellipsis";
				plisttd0.style.whiteSpace = "nowrap";
				plisttd0.style.fontSize = "14px";
				plisttd0.style.textAlign = "left";
				plisttd0.innerText = res.rows[i].name;
				plisttr.appendChild(plisttd0);
				const plisttd1 = document.createElement("td");
				plisttd1.style.padding = "3px";
				plisttd1.style.width = "120px";
				plisttd1.style.fontSize = "13px";
				plisttd1.style.textAlign = "right";
				const rdatesep = res.rows[i].r_datetime.split(' ');
				const rdatesepymd = rdatesep[0].split('-');
				plisttd1.innerText = parseInt(rdatesepymd[1]) + "月" + parseInt(rdatesepymd[1]) + "日 " + rdatesep[1];
				plisttr.appendChild(plisttd1);
			}
			plisttblscroll.appendChild(plisttbl);
			pupplist.appendChild(plisttblscroll);
			document.body.appendChild(bgscreen);
		}
	});
}

let iLiSTimer = null;
let iLiSNowSubject = {info:'科目情報読み込み中..'};
let iLiSDialog = null;

//iLiS表示
function openILiS(){
	console.log("openILIS");
	let html = '<div>';
	html	+= '  <div class="text-center" style="margin-bottom:1em; border-bottom: solid 1px gray; position:relative">';
//	html	+= '	<div style="position:absolute; right:0; bottom:1em"><a href="" onclick="return false;"><i class="glyphicon glyphicon-book"></i>受信テキスト</a></div>';
	html	+= '	<img src="/portal/img/iLiS/iLiS2.png" height="80" /><br/><button class="btn btn-danger" style="margin:0.5em; display:none" id="iLiSRecentCmdBtn" onclick="iLiSDoRecentCmd();" timeCode="0">クイズ実施中</button><br/>';
	html	+= '  </div>';
	html	+= '  <div id="iLiSSubjectInfo" style="font-size:120%; font-weight:bold">' + iLiSNowSubject.info;
	html	+= '  </div>';
	html	+= '  <fieldset id="iLiSReactionArea" style="margin-top:1em">';
	html	+= '	<legend>リアクション(間隔10秒以上)</legend>';
	html	+= '	<div style="line-height:300%" id="iLiSReactionBtnArea">';
	html	+= '		<button class="btn btn-primary" onclick="iLiSAction(\'hee\');" style="width:8em"><i class="glyphicon glyphicon-heart-empty"></i> へぇ～</button>&nbsp;';
	html	+= '		<button class="btn btn-primary" onclick="iLiSAction(\'ok\');" style="width:8em"><i class="glyphicon glyphicon-thumbs-up"></i> わかった</button>&nbsp;';
	html	+= '		<button class="btn btn-warning" onclick="iLiSAction(\'ng\');" style="width:8em"><i class="glyphicon glyphicon-thumbs-down"></i> わからん</button>&nbsp;';
	html	+= '		<button class="btn btn-warning" onclick="iLiSAction(\'wait\');" style="width:8em"><i class="glyphicon glyphicon-dashboard"></i> まって</button>&nbsp;';
	html	+= '	</div>';
	html	+= '	<div style="line-height:300%; display:none" id="iLiSNoReactionMsgArea">この科目ではリアクションは利用できません</div>';
	html	+= '  </fieldset>';
	html	+= '  <fieldset id="iLiSCommentTextArea" class="text-center" style="margin-top:1em">';
	html	+= '	<legend>コメントを送る</legend>';
	html	+= '	<div id="iLiSCommentInputArea">';
	html	+= '	<textarea class="form-control" style="display:inline-block; width:100%; height:5em"></textarea><br/>';
	html	+= '	<div style="width:100%">';
	html	+= '		<div style="float:left"><label><input type="checkbox" id="iLiSCommentAnonymousChk">匿名で送る</label></div>';
	html	+= '		<div class="text-right"><button class="btn btn-info" style="width:5em;" onclick="iLiSComment();">送る</button></div>';
	html	+= '	</div>';
	html	+= '	</div>';
	html	+= '	<div style="line-height:300%; display:none" id="iLiSNoCommentMsgArea">この科目ではコメントは利用できません</div>';
	html	+= '  </fieldset>';
	html	+= '  <div class="text-right" style="margin-top:1em; font-size:80%" id="iLiSMemoInfoArea">※受信したリンクやデータの確認は科目ページから行えます</div>';
	html	+= '</div>';

	if(!iLiSDialog){
		iLiSDialog = new tingle.modal({
			closeMethods: ['overlay', 'button', 'escape'],
			closeLabel: "閉じる",
			onClose: function() {
				if(iLiSTimer){
					clearInterval(iLiSTimer);
					iLiSTimer = null;
				}
			}
		});
		iLiSDialog.setContent(html);
	}
	iLiSDialog.open();

	let updateFunc = function(){
		let now = new Date();
		let nowHm = now.getHours()*100 + now.getMinutes();
		if(iLiSNowSubject.bufEndTime && nowHm <= Number(iLiSNowSubject.bufEndTime)) {
			return;
		}
		$("#iLiSReactionArea").hide();
		$("#iLiSCommentTextArea").hide();
		$("#iLiSMemoInfoArea").hide();
		startLoad();
		$.get("/portal/lmsinc/iLiSApi.php?type=nowtimetableinfo", function(res){
			console.log(res);
			if(res.row && res.row.iLiSUseFlag){
				iLiSNowSubject = res.row;
				iLiSNowSubject.info = escapeStr(iLiSNowSubject.class_name) + '(' + escapeStr(iLiSNowSubject.team_name) + ') <div style="display:inline-block">' + escapeStr(iLiSNowSubject.teacher_name) + ' 先生</div>';
				$("#iLiSReactionArea").show();
				$("#iLiSCommentTextArea").show();
				$("#iLiSMemoInfoArea").show();
				$("#iLiSReactionBtnArea").toggle(!iLiSNowSubject.iLiSSettings.noReaction);
				$("#iLiSNoReactionMsgArea").toggle(iLiSNowSubject.iLiSSettings.noReaction);
				$("#iLiSCommentInputArea").toggle(!iLiSNowSubject.iLiSSettings.noComment);
				$("#iLiSNoCommentMsgArea").toggle(iLiSNowSubject.iLiSSettings.noComment);
			}
			else if(res.row && !res.row.iLiSUseFlag){
				iLiSNowSubject = res.row;
				iLiSNowSubject.info = escapeStr(iLiSNowSubject.class_name) + '(' + escapeStr(iLiSNowSubject.team_name) + ') <div style="display:inline-block">' + escapeStr(iLiSNowSubject.teacher_name) + ' 先生</div>';
				iLiSNowSubject.info+= '<br/><br/><div style="background-color:#ff7; padding:0.5em">この科目ではiLiSは利用できません</div>';
			}
			else{
				iLiSNowSubject = [];
				iLiSNowSubject.info = '今の時間は時間割が登録されていません'
			}
			globalFunction.iLiSNowSubject = iLiSNowSubject;
			$("#iLiSSubjectInfo").html(iLiSNowSubject.info);
			endLoad();
		});
	};

	updateFunc();
	iLiSTimer = setInterval(updateFunc, 60000);

	//キューのチェック
	if(typeof window.globalFunction != 'undefined' && typeof window.globalFunction.send == 'function'){
		globalFunction.send('checkQue');
	}
}

//iLiSリアクション
function iLiSAction(type){
	if(typeof window.globalFunction != 'undefined' && typeof window.globalFunction.send == 'function'){
		window.globalFunction.send("action:" + type);
		$("#iLiSReactionBtnArea > button").attr("disabled", "disabled");
		setTimeout(function(){
			$("#iLiSReactionBtnArea > button").removeAttr("disabled");
		},10000)
	}
}

function iLiSComment(){
	let comment = $("#iLiSCommentInputArea > textarea").val();
	if(comment.trim() == '') return;
	let anonymousFlag = $("#iLiSCommentAnonymousChk").prop("checked");
	if(typeof window.globalFunction != 'undefined' && typeof window.globalFunction.send == 'function'){
		let param = {comment:comment, anonymousFlag:anonymousFlag};
		window.globalFunction.send("comment:" + JSON.stringify(param));
		$("#iLiSCommentInputArea > textarea").val('');
	}
	else{
		glexa.openCommonAlertModal({title:"エラー", body:"送信に失敗しました", onOk:function(
){ glexa.closeCommonAlertModal(); }} );
	}
}

function iLiSDoRecentCmd(){
	let timeCode = $("#iLiSRecentCmdBtn").attr("timeCode");
	if(timeCode == '0') return;
	if(typeof window.globalFunction != 'undefined' && typeof window.globalFunction.send == 'function'){
		window.globalFunction.send("cmdReSend:" + timeCode);
	}
	iLiSDialog.close();
}

const iLiSShareViewURL = "http://isclabo.thick.jp/ilis/view.html";
function openILiSSharedScreen(){
	let id = $(".user-icon").text().substr(0,11);
	let param = {host:globalFunction.iLiSScreenShareHost,id:id};
	let data = encodeURI(btoa(JSON.stringify(param)));
	console.log(data);
	window.open(iLiSShareViewURL+'?data='+data, "iLiSSharedScreenView", 'toolbar=no,menubar=no,scrollbars=no');
}

function startLoad(){
	if(glexa.loadingOverlay) glexa.loadingOverlay.remove();
	glexa.loadingOverlay=getBusyOverlay("viewport",{color:'black',opacity:0.1,text:'loading',style:'text-decoration:blink;font-weight:bold;font-size:12px;color:white;z-index:9999'},{color:'#666',size:100,type:'c'});
}

function endLoad(){
	glexa.loadingOverlay.remove();
}

let iLiSAckWaitTimer = null, iLiSAckWaitTime = 0;

function iLiSAckWait(ackKey, callbacks){
	$("#iLiSLogoArea").attr("waitKey", ackKey);
	startLoad();
	iLiSAckWaitTime = 0;
	iLiSAckWaitTimer = setInterval(function(){
		if(iLiSAckWaitTime >= 3000 || $("#iLiSLogoArea").attr("waitKey") == ''){
			endLoad();
			if(iLiSAckWaitTimer){
				clearInterval(iLiSAckWaitTimer);
				iLiSAckWaitTimer = null;
			}
			if($("#iLiSLogoArea").attr("waitKey") == ''){
				callbacks.success();
			}
			else{
				callbacks.error();
			}
			$("#iLiSLogoArea").attr("waitKey", "");
			return;
		}
		iLiSAckWaitTime += 100;
	}, 100);
}

//各科目のディレクトリ表示に対してiLiSコンテンツ表示も埋め込む(コンテンツがあれば)
let iLiSDirectoryQuizAry = [];
let iLiSDirectoryTextAry = [];

function viewILiSContents(classId, directoryId){
	const aTypeStr = {'select':'単一選択式', 'multi':'複数選択式', 'text':'記述式', 'image':'お絵かき'};
	const scoreMap = {0:{color:'red',mark:'×'}, 1:{color:'orange',mark:'△'}, 2:{color:'blue',mark:'○'}};

	$.when(
		$.get("/portal/lmsinc/iLiSApi.php?type=studentquizlistbydirectory&classId="+classId+"&directoryId="+directoryId),
		$.get("/portal/lmsinc/iLiSApi.php?type=studentrecvtextlist&classId="+classId+"&directoryId="+directoryId)
	)
	.done(function(res1, res2) {
		iLiSDirectoryQuizAry = res1[0].rows;
		if(!iLiSDirectoryQuizAry) iLiSDirectoryQuizAry = [];
		iLiSDirectoryTextAry = res2[0].rows;
		if(!iLiSDirectoryTextAry) iLiSDirectoryTextAry = [];
//		console.log(res1[0].rows);
//		console.log(res2[0].rows);
		if($("#div-class-ilis-contents").length == 0){
			let html = '<div id="div-class-ilis-contents">';
			html	+= '	<div class="panel panel-default">';
			html	+= '		<div class="panel-heading cf">';
			html	+= '			<i class="mark"></i> iLiSコンテンツ一覧';
			html	+= '		</div>';
			html	+= '		<div class="panel-body sp-padding-none" id="iLiSContentsList">';
			html	+= '			<div>●投票・クイズ</div>';
			html	+= '			<div class="table-responsive border-none">';
			html	+= '				<table class="table-class-content">';
			html	+= '				<thead><tr><th width="40"></th><th class="border-right-none">投票/問題文</th><th width="50" class="text-center">得点</th><th width="80" class="text-center">結果表示</th></tr></thead>';
			html	+= '				<tbody class="tbody-content-sort tbody-content-select" id="iLiSQuizContentList">';
			html	+= '				</tbody>';
			html	+= '				</table>';
			html	+= '			</div>';
			html	+= '			<div style="margin-top:1em">●受信URL・受信テキスト</div>';
			html	+= '			<div class="table-responsive border-none">';
			html	+= '				<table class="table-class-content">';
			html	+= '				<thead><tr><th width="40"></th><th width="60" class="text-center">受信日</th><th width="60" class="text-center">受信時刻</th><th class="border-right-none">受信内容</th><th width="80" class="text-center">再表示</th></tr></thead>';
			html	+= '				<tbody class="tbody-content-sort tbody-content-select" id="iLiSTextContentList">';
			html	+= '				</tbody>';
			html	+= '				</table>';
			html	+= '			</div>';
			html	+= '		</div>';
			html	+= '	</div>';
			html	+= '</div>';
			$("#div-class-contents").after(html);
		}
		if(iLiSDirectoryQuizAry.length == 0 && iLiSDirectoryTextAry.length == 0){
			$("#div-class-ilis-contents").hide();
		}
		else{
			$("#div-class-ilis-contents").show();

			//クイズ等
			let html = '', i;
			for(i = 0; i < iLiSDirectoryQuizAry.length; i++){
				let quiz = iLiSDirectoryQuizAry[i];
				html += '<tr class="tr-content">';
				let img = (quiz.qType == 'quiz') ? '/lms/plugins/quiz/images/icon_transparent.png' : '/lms/plugins/vote/images/icon_transparent.png';
				html += '	<td class="border-right-none vertical-align-top"><div class="plugin-icon-wrapper"><img src="'+img+'" class="plugin-icon"><i class="state"></i></div></td>';
				html += '<td class="border-left-noneborder-right-none vertical-align-middle"><div><div><b>'+escapeStrB(quiz.question)+'</b>';
				html += '<div class="text-right"><small>('+aTypeStr[quiz.aType]+')</small></div></div></div></td>';
				let w = quiz.score == null ? '' : '<span style="color:'+scoreMap[quiz.score].color+'">'+scoreMap[quiz.score].mark+'</span>';
				html += '<td class="text-center" style="font-size:13pt; font-weight:bold">' + w + '</td>';
				html += '<td class="text-center"><button class="btn btn-sm btn-primary" onclick="iLiSStudentQuizResultViewPre('+i+');">表示</button></td>';
				html += '</tr>';
			}
			if(i == 0) html = '<tr><td class="p-2 text-center" colspan="4">登録されていません</td></tr>';
			$("#iLiSQuizContentList").html(html);

			//テキスト等
			html = '';
			let preDate = '';
			for(i = 0; i < iLiSDirectoryTextAry.length; i++){
				let item = iLiSDirectoryTextAry[i];
				html += '<tr class="tr-content">';
				let img = (item.sendType == 'U') ? '/portal/img/link.png' : '/lms/common/images/icons/resource_icon_transparent.png';
				html += '	<td class="border-right-none vertical-align-top"><div class="plugin-icon-wrapper"><img src="'+img+'" class="plugin-icon"><i class="state"></i></div></td>';
				let w = item.sendDate != preDate ? item.sendDate.substr(4,2)+'/'+item.sendDate.substr(6,2) : '〃';
				html += '<td class="text-center">' + w + '</td>';
				w = item.sendTime.substr(0,2)+':'+item.sendTime.substr(2,2);
				html += '<td class="text-center">' + w + '</td>';
				w = item.sendType == 'U' ? '<a href="'+item.sendParam+'" target="_blank">'+item.sendParam+'</a>' : escapeStrB(item.sendParam.length > 80 ? item.sendParam.substr(0,80)+'...' : item.sendParam);
				html += '<td class="border-left-noneborder-right-none vertical-align-middle"><div><div>'+w+'</div></div></td>';
				if(item.sendType == 'U'){
					html += '<td class="text-center"></td>';
				}
				else{
					html += '<td class="text-center"><button class="btn btn-sm btn-primary" onclick="iLiSStudentTextViewPre('+i+');">表示</button></td>';
				}
				html += '</tr>';
				preDate = item.sendDate;
			}
			if(i == 0) html = '<tr><td class="p-2 text-center" colspan="5">登録されていません</td></tr>';
			$("#iLiSTextContentList").html(html);
		}
	})
	.fail(function() {
		console.log('error');
	});
}

function iLiSStudentQuizResultViewPre(idx){
	let quiz = iLiSDirectoryQuizAry[idx];
	let obj = { quiz:quiz, correctAnswer:{choiceAnswerFlgs:quiz.choiceAnswerFlgs, textAnswers:quiz.textAnswers, imageAnswer64:quiz.imageAnswer64}, score:quiz.score, answer:{answerChoices:quiz.answerChoices, answerText:quiz.answerText, answerImage:quiz.answerImage64} };
	iLiSStudentQuizResultView(obj);
}

function iLiSStudentTextViewPre(idx){
	let text = iLiSDirectoryTextAry[idx];
	let obj = { text:text.sendParam, time:text.sendTime };
	iLiSStudentTextView(obj, false);
}
